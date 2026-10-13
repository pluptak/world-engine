using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The shared driver (IWorldDriver) answers the same from either world: the store-write commands and the two store-edit edits, run through
// a memory world and through a stored world over the same starting snapshot, must agree on every status, the final snapshot, the history
// and the attempts. The stored world's answers are the TypeScript store's (its own goldens); this checks the memory world against them.
public class WorldDriverTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "worlddriver-" + Guid.NewGuid().ToString("N"));

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
    public void A_memory_world_and_a_stored_world_answer_the_same_through_the_driver()
    {
        var dir = Path.Combine(scratch, "stored");
        CopyTree(Path.Combine(Fixtures, "store-write-start"), dir);
        var registry = WorldFiles.ReadTemplates(dir);
        var start = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        var names = WorldFiles.ReadIds(dir);
        var stored = StoreWorld.Open(dir, snapshotEvery: 2, checkpointEvery: 2);
        var memory = new MemoryWorld(start, registry, WorldReplay.HashOf(registry), names);

        var commands = WorldJson.Read<List<Command>>(File.ReadAllText(Path.Combine(Fixtures, "store-write.commands.json")));
        var edits = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "store-edit.edits.json")))!;
        Assert.Equal(Answers(stored, commands, edits), Answers(memory, commands, edits));
    }

    // The answers of one driver to the whole sequence: each status and reason, the final snapshot, the history and the attempts. The
    // stored world is run first, and the memory world is run on a fresh copy of the same starting point by the caller's order.
    private static IReadOnlyList<string> Answers(IWorldDriver driver, List<Command> commands, JsonArray edits)
    {
        var answers = new List<string>();
        foreach (var command in commands)
        {
            var result = driver.Apply(command);
            answers.Add($"{result.CommandId} {result.Status} {result.ReasonCode}");
        }
        foreach (var item in edits)
        {
            var result = driver.Edit(item!["edit"]!.AsObject(), item["command_id"]?.GetValue<string>());
            answers.Add($"{result.CommandId} {result.Status} {result.ReasonCode}");
        }
        answers.Add(CanonicalJson.Serialize(JsonNode.Parse(WorldJson.Write(driver.CurrentSnapshot()))));
        var (deltas, events) = driver.Since(0);
        answers.Add(CanonicalJson.Serialize(JsonNode.Parse(WorldJson.Write(deltas))));
        answers.Add(CanonicalJson.Serialize(JsonNode.Parse(WorldJson.Write(events))));
        foreach (var attempt in driver.Attempts(0))
        {
            answers.Add($"{attempt.Command.CommandId} {attempt.BasedOnVersion} {attempt.Version} {attempt.Status}");
        }
        return answers;
    }

    private static List<string> Files(string root) =>
        [.. Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)];

    private static void CopyTree(string from, string to)
    {
        foreach (var relative in Files(from))
        {
            var target = Path.Combine(to, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(Path.Combine(from, relative), target);
        }
    }
}
