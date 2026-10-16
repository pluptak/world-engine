using System.Diagnostics;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// Writers take turns across processes (src/store/lock.ts; the TypeScript reference is tests/store-lock.test.ts). Each child is the lock
// child program (tests/WorldEngine.LockChild), one writer per process: six deciding commands and two readers at once, and three editors at
// once. Every command is logged once, at the version before it, the files are the replay's, and no lock or temporary is left behind.
public class WorldLockProcessTests : IDisposable
{
    private static readonly string Start = Path.Combine(AppContext.BaseDirectory, "Fixtures", "store-write-start");
    private static readonly string Child = Path.Combine(AppContext.BaseDirectory, "WorldEngine.LockChild.dll");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storelock-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(scratch, recursive: true);
        }
        catch (IOException)
        {
            // A file a failed test left open is the test's own leftover.
        }
    }

    [Fact]
    public async Task Six_processes_writing_one_world_take_turns_and_every_command_is_logged_once()
    {
        var dir = NewWorld();
        var commands = Depth.Count(deep: 20, sampled: 5);
        var kids = new[]
        {
            Spawn("commands", dir, "a", commands),
            Spawn("commands", dir, "b", commands),
            Spawn("commands", dir, "c", commands),
            Spawn("commands", dir, "d", commands),
            Spawn("commands", dir, "e", commands),
            Spawn("commands", dir, "f", commands),
            Spawn("reads", dir, "g", Depth.Count(deep: 150, sampled: 40)),
            Spawn("reads", dir, "h", Depth.Count(deep: 150, sampled: 40)),
        };
        var results = await Task.WhenAll(kids);
        Assert.All(results, result => Assert.True(result.Code == 0, $"child exited {result.Code}: {result.Output}"));

        var registry = WorldFiles.ReadTemplates(dir);
        var log = WorldFiles.ReadLog(dir);
        Assert.Equal(6 * commands, log.Count);
        // Conflicting commands are refused, so not all are ok; the ones that are each follow the last.
        var accepted = log.Where(entry => entry.Status == Status.Ok).Select(entry => entry.Version).ToList();
        Assert.Equal(Enumerable.Range(0, accepted.Count).Select(index => (long)index), accepted);

        var settled = WorldSettle.Load(dir, registry);
        Assert.Equal(accepted.Count, settled.Version);
        Assert.Equal(Canonical(WorldReplay.ReplayFold(dir, registry).Snapshot), Canonical(settled));
        Assert.Equal(Canonical(WorldFiles.ReadEvents(dir)), Canonical(WorldHistory.Since(dir, 0, registry).Events));
        Assert.Empty(Leftovers(dir));
    }

    [Fact]
    public async Task Three_processes_editing_at_once_name_distinct_next_edits()
    {
        var dir = NewWorld();
        var kids = new[] { Spawn("edits", dir, "a", 10), Spawn("edits", dir, "b", 10), Spawn("edits", dir, "c", 10) };
        var results = await Task.WhenAll(kids);
        Assert.All(results, result => Assert.True(result.Code == 0, $"child exited {result.Code}: {result.Output}"));

        var ids = WorldFiles.ReadLog(dir).Select(entry => entry.Command.CommandId).ToList();
        Assert.Equal(Enumerable.Range(1, 30).Select(index => $"edit-{index}"), ids);
        Assert.Empty(Leftovers(dir));
    }

    private string NewWorld()
    {
        var dir = Path.Combine(scratch, "world");
        Directory.CreateDirectory(dir);
        foreach (var file in Directory.EnumerateFiles(Start))
        {
            File.Copy(file, Path.Combine(dir, Path.GetFileName(file)));
        }
        return dir;
    }

    private static Task<(int Code, string Output)> Spawn(string mode, string dir, string who, int count)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        // The test is about taking turns, not about the wait running out: eight cold-started processes on a busy host can queue longer
        // than the default five seconds, and the lock is not fair.
        start.Environment["WORLD_LOCK_TIMEOUT_MS"] = "60000";
        start.ArgumentList.Add(Child);
        start.ArgumentList.Add(mode);
        start.ArgumentList.Add(dir);
        start.ArgumentList.Add(who);
        start.ArgumentList.Add(count.ToString());
        var process = Process.Start(start) ?? throw new InvalidOperationException("The lock child did not start");
        var output = process.StandardOutput.ReadToEndAsync();
        var errors = process.StandardError.ReadToEndAsync();
        return Done(process, output, errors);
    }

    private static async Task<(int Code, string Output)> Done(Process process, Task<string> output, Task<string> errors)
    {
        await process.WaitForExitAsync();
        var text = await output;
        var error = await errors;
        return (process.ExitCode, text + error);
    }

    // Files a finished writer must not leave: the turn, a temporary, or a taken-over lock's grave.
    private static List<string> Leftovers(string dir) =>
        [.. Directory.EnumerateFiles(dir)
            .Select(Path.GetFileName)
            .OfType<string>()
            .Where(name => name == "lock" || name.Contains(".tmp") || name.Contains(".stale-"))];

    private static string Canonical<T>(T value) => CanonicalJson.Serialize(JsonNode.Parse(WorldJson.Write(value)));
}
