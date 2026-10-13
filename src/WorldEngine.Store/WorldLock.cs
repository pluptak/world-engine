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
// processes) and holding who made it, when, and a nonce unique to each acquisition. That clock reading only judges a lock's age,
// never reaches the world. A takeover and a release proceed only for the lock their bytes name: anything another writer made in
// between is put back or left alone, never deleted.
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

    // The worlds this thread holds, with the exact lock text each acquisition wrote. A call made while holding one (`submit` calls
    // `load`) is already inside, so it does not wait for its own turn. The text binds the release to the same lock the acquisition
    // made: a lock another writer made in between is left alone.
    [ThreadStatic]
    private static Dictionary<string, string>? held;

    private static long _seq;

    private sealed record Owner(int Pid, long SinceMs, string Nonce);

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
        held ??= new Dictionary<string, string>(StringComparer.Ordinal);
        if (held.ContainsKey(key))
        {
            return body();
        }
        var path = Path.Combine(dir, LockFile);
        var mine = Acquire(path, dir, timeoutMs ?? TimeoutFromEnvironment());
        held.Add(key, mine);
        try
        {
            return body();
        }
        finally
        {
            held.Remove(key);
            Release(path, 55, mine);
        }
    }

    private static long TimeoutFromEnvironment()
    {
        var asked = Environment.GetEnvironmentVariable("WORLD_LOCK_TIMEOUT_MS");
        return double.TryParse(asked, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && value > 0 && double.IsFinite(value)
            ? (long)value
            : DefaultTimeoutMs;
    }

    private static string Acquire(string path, string dir, long timeoutMs)
    {
        var deadline = NowMs() + timeoutMs;
        for (var wait = 1; ; wait = Math.Min(wait * 2, LongestPauseMs))
        {
            var mine = Create(path) ?? (TakeOver(path) ? Create(path) : null);
            if (mine is not null)
            {
                return mine;
            }
            if (NowMs() >= deadline)
            {
                throw new WorldError("store_busy", $"World at {dir} is being written by another process");
            }
            Thread.Sleep(wait);
        }
    }

    // Makes the turn, answering the exact text written, or null when it is held (including a lock just given back that a waiter
    // still has open). The nonce tells each acquisition apart, so a takeover and a release can refer to the same lock by its bytes.
    private static string? Create(string path)
    {
        FileStream stream;
        try
        {
            stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
        var text = CanonicalJson.Serialize(new JsonObject
        {
            ["pid"] = Environment.ProcessId,
            ["since_ms"] = NowMs(),
            ["nonce"] = $"{Environment.ProcessId}-{Interlocked.Increment(ref _seq)}",
        });
        try
        {
            using var writer = new StreamWriter(stream);
            writer.Write(text);
        }
        catch
        {
            stream.Dispose();
            File.Delete(path);
            throw;
        }
        stream.Dispose();
        return text;
    }

    // True when the lock is gone and the turn can be tried for again. The verdict below must refer to the same lock the rename
    // moves: the judged bytes are compared with what arrived in the grave, and anything else is put back.
    private static bool TakeOver(string path)
    {
        string judged;
        try
        {
            judged = WorldIO.ReadAllText(path);
        }
        catch (FileNotFoundException)
        {
            return true;
        }
        catch (Exception error) when (Busy(error))
        {
            return false;
        }
        if (JudgeText(path, judged) != Verdict.Stale)
        {
            return Judge(path) == Verdict.Gone;
        }
        return TakeOverJudged(path, judged);
    }

    // Renames a lock judged stale away, proceeding only when the grave holds the judged bytes. A lock another writer made after
    // the verdict is put back when the turn is still free, never deleted.
    internal static bool TakeOverJudged(string path, string judged)
    {
        var grave = $"{path}.stale-{Environment.ProcessId}";
        try
        {
            File.Move(path, grave);
        }
        catch (FileNotFoundException)
        {
            return true;
        }
        catch (Exception error) when (Busy(error))
        {
            return false;
        }
        string moved;
        try
        {
            moved = WorldIO.ReadAllText(grave);
        }
        catch (Exception error) when (Busy(error) || error is FileNotFoundException)
        {
            return false;
        }
        if (!string.Equals(moved, judged, StringComparison.Ordinal))
        {
            try
            {
                File.Move(grave, path);
            }
            catch (Exception error) when (Busy(error) || error is FileNotFoundException)
            {
                // The turn is taken again already, or the grave is gone: either way it is not this taker's to delete.
            }
            return false;
        }
        Release(grave, GravePatienceMs, judged);
        SweepLeftovers(Path.GetDirectoryName(path)!, ParseOwner(judged)?.Pid);
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
            return JudgeText(path, WorldIO.ReadAllText(path));
        }
        catch (FileNotFoundException)
        {
            return Verdict.Gone;
        }
        catch (Exception error) when (Busy(error))
        {
            return Verdict.Live;
        }
    }

    private static Verdict JudgeText(string path, string text)
    {
        var owner = ParseOwner(text);
        var since = owner?.SinceMs ?? new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds();
        var left = (owner is not null && !Alive(owner.Pid)) || NowMs() - since > StaleAfterMs;
        return left ? Verdict.Stale : Verdict.Live;
    }

    // A file another process has open, or is deleting or making: Windows reports it as a sharing failure or as access denied, and both
    // mean the same thing here, that the lock belongs to someone.
    private static bool Busy(Exception error) => error is IOException or UnauthorizedAccessException;

    // The owner a lock's bytes name, or null when they are empty or cut short: the maker is between creating and writing, or died
    // there. A lock written before nonces names none, and judges like one with an empty nonce.
    private static Owner? ParseOwner(string text)
    {
        try
        {
            var value = JsonNode.Parse(text)?.AsObject();
            var pid = value?["pid"] is JsonNode pidNode ? JsonReads.SafeInt(pidNode) : null;
            var since = value?["since_ms"] is JsonNode sinceNode ? JsonReads.Number(sinceNode) : null;
            var nonce = value?["nonce"] is JsonNode nonceNode ? JsonReads.Text(nonceNode) : null;
            return pid is not null && since is not null ? new Owner((int)pid.Value, (long)since.Value, nonce ?? "") : null;
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
        foreach (var folder in new[] { dir, Path.Combine(dir, WorldCheckpoints.Folder) })
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

    // Removes the lock held as `expected`, asking for a while first: Windows holds a file a reader has open until it lets go. A lock
    // another writer made in between is left alone.
    private static void Release(string path, long patienceMs, string expected)
    {
        var deadline = NowMs() + patienceMs;
        for (var attempt = 1; ; attempt += 1)
        {
            string current;
            try
            {
                current = WorldIO.ReadAllText(path);
            }
            catch (FileNotFoundException)
            {
                return;
            }
            catch (Exception error) when (Busy(error))
            {
                if (NowMs() >= deadline)
                {
                    return;
                }
                Thread.Sleep(Math.Min(attempt, 10));
                continue;
            }
            if (!string.Equals(current, expected, StringComparison.Ordinal))
            {
                return;
            }
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
