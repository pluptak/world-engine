using System.Diagnostics;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The turn on a world directory (src/store/lock.ts, tests/store-lock.test.ts). These run in one process; the two-process cases of the
// TypeScript test are the ones that need a child process, and they follow once a child harness exists.
public class WorldLockTests : IDisposable
{
    // A pid no live process has, so a lock naming it is one its holder left behind.
    private const int DeadPid = 2147483646;

    private readonly string dir = Path.Combine(Path.GetTempPath(), "worldlock-" + Guid.NewGuid().ToString("N"));

    public WorldLockTests() => Directory.CreateDirectory(dir);

    public void Dispose()
    {
        try
        {
            Directory.Delete(dir, recursive: true);
        }
        catch (IOException)
        {
            // A lock left open by a failed test is the test's own leftover; nothing else depends on this directory.
        }
    }

    private string LockPath => Path.Combine(dir, WorldLock.LockFile);

    private void HoldAs(int pid, long sinceMs) => File.WriteAllText(LockPath, $"{{\"pid\":{pid},\"since_ms\":{sinceMs}}}");

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    [Fact]
    public void A_writer_that_cannot_get_its_turn_fails_store_busy_after_the_timeout_and_changes_nothing()
    {
        HoldAs(Environment.ProcessId, NowMs());
        var started = Stopwatch.StartNew();

        var error = Assert.Throws<WorldError>(() => WorldLock.With(dir, () => 1, timeoutMs: 150));

        Assert.Equal("store_busy", error.Code);
        Assert.True(started.ElapsedMilliseconds >= 150, "waited out the timeout");
        Assert.True(started.ElapsedMilliseconds < 3000, "gave up at the timeout asked for");
        Assert.True(File.Exists(LockPath), "a lock that is not stale is left to its holder");
    }

    [Fact]
    public void A_lock_whose_holder_is_gone_is_taken_over()
    {
        HoldAs(DeadPid, NowMs());

        Assert.Equal(7, WorldLock.With(dir, () => 7, timeoutMs: 500));

        Assert.False(File.Exists(LockPath));
    }

    [Fact]
    public void A_lock_older_than_a_minute_is_taken_over_even_when_its_holder_lives()
    {
        HoldAs(Environment.ProcessId, NowMs() - 120_000);

        Assert.Equal(7, WorldLock.With(dir, () => 7, timeoutMs: 500));
    }

    [Fact]
    public void An_unowned_lock_is_waited_for_while_young()
    {
        File.WriteAllText(LockPath, string.Empty);

        var error = Assert.Throws<WorldError>(() => WorldLock.With(dir, () => 1, timeoutMs: 150));

        Assert.Equal("store_busy", error.Code);
        Assert.True(File.Exists(LockPath));
    }

    [Fact]
    public void An_unowned_lock_left_a_minute_is_taken_over()
    {
        File.WriteAllText(LockPath, string.Empty);
        File.SetLastWriteTimeUtc(LockPath, DateTime.UtcNow.AddMinutes(-2));

        Assert.Equal(7, WorldLock.With(dir, () => 7, timeoutMs: 500));
    }

    [Fact]
    public void The_turn_is_given_back_when_the_work_throws()
    {
        Assert.Throws<InvalidOperationException>(() => WorldLock.With<int>(dir, () => throw new InvalidOperationException(), timeoutMs: 500));

        Assert.False(File.Exists(LockPath));
        Assert.Equal(3, WorldLock.With(dir, () => 3, timeoutMs: 500));
    }

    [Fact]
    public void A_nested_call_does_not_wait_for_its_own_turn()
    {
        var started = Stopwatch.StartNew();

        var inner = WorldLock.With(dir, () => WorldLock.With(dir, () => 9, timeoutMs: 5000), timeoutMs: 5000);

        Assert.Equal(9, inner);
        Assert.True(started.ElapsedMilliseconds < 2000);
        Assert.False(File.Exists(LockPath));
    }

    [Fact]
    public void A_takeover_sweeps_the_leftovers_of_a_dead_process_and_keeps_those_of_a_live_one()
    {
        // A process that is alive and not this one: the System process on Windows, init elsewhere.
        var livePid = OperatingSystem.IsWindows() ? 4 : 1;
        File.WriteAllText(Path.Combine(dir, $"world.json.{DeadPid}.tmp"), "half");
        File.WriteAllText(Path.Combine(dir, $"world.json.{livePid}.tmp"), "theirs");
        File.WriteAllText(Path.Combine(dir, "old.tmp"), "shared");
        HoldAs(DeadPid, NowMs());

        WorldLock.With(dir, () => 0, timeoutMs: 500);

        Assert.False(File.Exists(Path.Combine(dir, $"world.json.{DeadPid}.tmp")));
        Assert.False(File.Exists(Path.Combine(dir, "old.tmp")));
        Assert.True(File.Exists(Path.Combine(dir, $"world.json.{livePid}.tmp")));
    }

    [Fact]
    public void Acquired_locks_carry_a_nonce_unique_to_each_acquisition()
    {
        string first = "", second = "";
        WorldLock.With(dir, () => { first = File.ReadAllText(LockPath); return 0; }, timeoutMs: 500);
        WorldLock.With(dir, () => { second = File.ReadAllText(LockPath); return 0; }, timeoutMs: 500);

        Assert.Contains("nonce", first);
        Assert.Contains("nonce", second);
        Assert.NotEqual(NonceOf(first), NonceOf(second));
    }

    // The nonce the lock names, failing when the lock names none: comparing whole files would pass on differing timestamps alone.
    private static string NonceOf(string lockText)
    {
        var nonce = ((JsonObject)JsonNode.Parse(lockText)!)["nonce"]?.GetValue<string>();
        Assert.NotNull(nonce);
        return nonce!;
    }

    [Fact]
    public void Release_leaves_a_lock_it_does_not_own_alone()
    {
        const string intruder = "{\"pid\":1,\"since_ms\":1,\"nonce\":\"not-mine\"}";
        WorldLock.With(dir, () =>
        {
            File.WriteAllText(LockPath, intruder);
            return 0;
        }, timeoutMs: 500);

        Assert.True(File.Exists(LockPath), "release deleted a lock it does not own");
        Assert.Equal(intruder, File.ReadAllText(LockPath));
    }

    [Fact]
    public void Takeover_puts_back_a_lock_that_changed_since_the_verdict()
    {
        var live = $"{{\"pid\":{Environment.ProcessId},\"since_ms\":{NowMs()},\"nonce\":\"live-1\"}}";
        var judged = $"{{\"pid\":{DeadPid},\"since_ms\":{NowMs()},\"nonce\":\"stale-1\"}}";
        File.WriteAllText(LockPath, live);

        Assert.False(WorldLock.TakeOverJudged(LockPath, judged));
        Assert.Equal(live, File.ReadAllText(LockPath));
        Assert.Empty(Directory.EnumerateFiles(dir, "lock.stale-*"));
    }
}
