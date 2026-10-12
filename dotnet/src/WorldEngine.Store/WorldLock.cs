using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;

namespace WorldEngine.Store;

// Writers take turns (src/store/lock.ts, docs/locking.md). A world directory has no server and the CLI is one process per request, so
// two callers at once are two writers on the same files. The turn is a file named `lock`, made with the exclusive flag (atomic across
// processes) and holding who made it and when. That clock reading only judges a lock's age, never reaches the world.
//
// Whoever finds the file waits and tries again, up to a timeout, then fails `store_busy`. A lock whose process is gone, or that is older
// than a minute, was left by a crash and is taken over: the log is the truth, and what a crashed submit left half done is settled by the
// repair `load` has.
public static class WorldLock
{
    public const string LockFile = "lock";
    private const long DefaultTimeoutMs = 5_000;
    private const long StaleAfterMs = 60_000;
    private const int LongestPauseMs = 20;

    // How long a taker keeps asking for its grave back: the grave is its own, so the only thing in the way is a reader that has it open.
    private const long GravePatienceMs = 1_000;

    private static readonly Regex Temporary = new(@"\.(\d+)\.tmp$", RegexOptions.CultureInvariant);
    private static readonly Regex Grave = new(@"^lock\.stale-(\d+)$", RegexOptions.CultureInvariant);

    // The worlds this thread holds. A call made while holding one (`submit` calls `load`) is already inside, so it does not wait for
    // its own turn.
    [ThreadStatic]
    private static HashSet<string>? held;

    private sealed record Owner(int Pid, long SinceMs);

    private enum Verdict
    {
        Gone,
        Stale,
        Live,
    }

    // Runs `body` with this process's turn on the world at `dir`, which must exist. Re-entrant. `timeoutMs` is how long to wait for the
    // turn; by default `WORLD_LOCK_TIMEOUT_MS`, else 5 s.
    public static T With<T>(string dir, Func<T> body, long? timeoutMs = null)
    {
        var key = Path.GetFullPath(dir);
        held ??= new HashSet<string>(StringComparer.Ordinal);
        if (held.Contains(key))
        {
            return body();
        }
        var path = Path.Combine(dir, LockFile);
        Acquire(path, dir, timeoutMs ?? TimeoutFromEnvironment());
        held.Add(key);
        try
        {
            return body();
        }
        finally
        {
            held.Remove(key);
            Release(path, 55);
        }
    }

    private static long TimeoutFromEnvironment()
    {
        var asked = Environment.GetEnvironmentVariable("WORLD_LOCK_TIMEOUT_MS");
        return double.TryParse(asked, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value > 0 && double.IsFinite(value)
            ? (long)value
            : DefaultTimeoutMs;
    }

    private static void Acquire(string path, string dir, long timeoutMs)
    {
        var deadline = NowMs() + timeoutMs;
        for (var wait = 1; ; wait = Math.Min(wait * 2, LongestPauseMs))
        {
            if (Create(path) || (TakeOver(path) && Create(path)))
            {
                return;
            }
            if (NowMs() >= deadline)
            {
                throw new WorldError("store_busy", $"World at {dir} is being written by another process");
            }
            Thread.Sleep(wait);
        }
    }

    // Makes the turn. False when it is held, including a lock just given back that a waiter still has open.
    private static bool Create(string path)
    {
        FileStream stream;
        try
        {
            stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
        try
        {
            var owner = new JsonObject { ["pid"] = Environment.ProcessId, ["since_ms"] = NowMs() };
            using var writer = new StreamWriter(stream);
            writer.Write(CanonicalJson.Serialize(owner));
        }
        catch
        {
            stream.Dispose();
            File.Delete(path);
            throw;
        }
        stream.Dispose();
        return true;
    }

    // True when the lock is gone and the turn can be tried for again. The file is renamed away, not deleted: of two waiters that judge the
    // same lock stale only one rename finds it. A rename that caught a lock another waiter made in between is put back.
    private static bool TakeOver(string path)
    {
        var verdict = Judge(path);
        if (verdict != Verdict.Stale)
        {
            return verdict == Verdict.Gone;
        }
        var grave = $"{path}.stale-{Environment.ProcessId}";
        try
        {
            File.Move(path, grave);
        }
        catch (FileNotFoundException)
        {
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        if (Judge(grave) == Verdict.Live)
        {
            try
            {
                File.Move(grave, path);
            }
            catch (IOException)
            {
                // Taken again already; that holder's turn is the one at risk, and the repair on load covers it.
            }
            return false;
        }
        int? evicted = null;
        try
        {
            evicted = ReadOwner(grave)?.Pid;
        }
        catch (FileNotFoundException)
        {
            // Already gone.
        }
        // Another waiter's judging may still have the grave open, which Windows reports as a failed removal. Nobody else renames to this
        // name, so it is asked for patiently; what still stands is swept below.
        Release(grave, GravePatienceMs);
        SweepLeftovers(Path.GetDirectoryName(path)!, evicted);
        return true;
    }

    // Whether the lock is gone, provably left behind, or held. A lock that cannot be read now belongs to somebody.
    private static Verdict Judge(string path)
    {
        if (!File.Exists(path))
        {
            return Verdict.Gone;
        }
        try
        {
            var owner = ReadOwner(path);
            var since = owner?.SinceMs ?? new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds();
            var left = (owner is not null && !Alive(owner.Pid)) || NowMs() - since > StaleAfterMs;
            return left ? Verdict.Stale : Verdict.Live;
        }
        catch (FileNotFoundException)
        {
            return Verdict.Gone;
        }
        catch (IOException)
        {
            return Verdict.Live;
        }
    }

    // The owner a lock names, or null when it is empty or cut short: its maker is between creating it and writing it, or died there.
    // Throws FileNotFoundException when the lock is gone.
    private static Owner? ReadOwner(string path)
    {
        string text;
        try
        {
            text = File.ReadAllText(path);
        }
        catch (FileNotFoundException)
        {
            throw;
        }
        catch (IOException)
        {
            return null;
        }
        try
        {
            var value = JsonNode.Parse(text)?.AsObject();
            var pid = value?["pid"] is JsonNode pidNode ? JsonReads.SafeInt(pidNode) : null;
            var since = value?["since_ms"] is JsonNode sinceNode ? JsonReads.Number(sinceNode) : null;
            return pid is not null && since is not null ? new Owner((int)pid.Value, (long)since.Value) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // Whether a process exists. No permission to signal it still means it exists.
    private static bool Alive(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (Exception)
        {
            return true;
        }
    }

    // The pid a leftover file is named for: a writer's temporary (`<name>.<pid>.tmp`) or a taker's grave (`lock.stale-<pid>`). 0 is an old
    // shared `.tmp` no live writer names; null is anything else.
    private static int? LeftBy(string name)
    {
        var found = Temporary.Match(name);
        if (!found.Success)
        {
            found = Grave.Match(name);
        }
        if (found.Success)
        {
            return int.Parse(found.Groups[1].Value, CultureInfo.InvariantCulture);
        }
        return name.EndsWith(".tmp", StringComparison.Ordinal) ? 0 : null;
    }

    // What a crashed writer leaves besides the lock: temporaries named for its pid, and graves of takers that died. The sweep runs before
    // the sweeper has the turn, so it takes only what no live process could be using: a file of a dead pid, of the `evicted` holder, or of
    // this process, which is not writing anything while it sweeps.
    private static void SweepLeftovers(string dir, int? evicted)
    {
        foreach (var folder in new[] { dir, Path.Combine(dir, "checkpoints") })
        {
            if (!Directory.Exists(folder))
            {
                continue;
            }
            foreach (var name in Directory.EnumerateFileSystemEntries(folder).Select(entry => Path.GetFileName(entry)).OfType<string>().ToList())
            {
                var pid = LeftBy(name);
                if (pid is null || (pid > 0 && pid != evicted && pid != Environment.ProcessId && Alive(pid.Value)))
                {
                    continue;
                }
                try
                {
                    File.Delete(Path.Combine(folder, name));
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                    // Someone else's sweep got there first.
                }
            }
        }
    }

    // Removes the lock, asking for a while first: Windows holds a file a reader has open until it lets go.
    private static void Release(string path, long patienceMs)
    {
        var deadline = NowMs() + patienceMs;
        for (var attempt = 1; ; attempt += 1)
        {
            try
            {
                File.Delete(path);
                return;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                if (!File.Exists(path) || NowMs() >= deadline)
                {
                    return;
                }
                Thread.Sleep(Math.Min(attempt, 10));
            }
        }
    }

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}
