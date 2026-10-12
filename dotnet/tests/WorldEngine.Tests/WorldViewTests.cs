using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The view side of a world (IWorld) answered alike by a memory world and a stored world: one sequence of commands, observations, checks,
// options, scheduled causes, heard events, an observed command and a round, run through each, must give the same answers at every step
// and the same final snapshot and history. The memory world's answers are the TypeScript ones (its goldens); this holds the stored one to
// them.
public class WorldViewTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "worldview-" + Guid.NewGuid().ToString("N"));

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
    public void A_memory_world_and_a_stored_world_answer_the_view_alike()
    {
        var dir = Path.Combine(scratch, "stored");
        CopyTree(Path.Combine(Fixtures, "store-write-start"), dir);
        var registry = WorldFiles.ReadTemplates(dir);
        var start = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        IWorld stored = StoreWorld.Open(dir, snapshotEvery: 2, checkpointEvery: 2);
        IWorld memory = new MemoryWorld(start, registry, WorldReplay.HashOf(registry), WorldFiles.ReadIds(dir));

        Assert.Equal(Answers(stored, start), Answers(memory, start));
    }

    // Everything the view says of a world over the sequence, in order, as canonical text.
    private static IReadOnlyList<string> Answers(IWorld world, Snapshot start)
    {
        var answers = new List<string>();
        var commands = WorldJson.Read<List<Command>>(File.ReadAllText(Path.Combine(Fixtures, "store-write.commands.json")));
        foreach (var command in commands)
        {
            answers.Add(Text(world.Apply(command, null, observe: false)));
        }
        answers.Add(Text(world.Observe("e2")));
        answers.Add(Text(world.Observe("e2", since: 1)));
        answers.Add(Text(world.Observe("e2", sinceTick: 0)));
        answers.Add(Text(world.Inspect("e2", "e3")));
        answers.Add(Text(world.Inspect("e2", "e4")));
        answers.Add(Text(world.QueryFact("e3", "contained_in", "e1")));
        answers.Add(Text(world.QueryPerceive("e2", "sight", entity: "e3")));
        answers.Add(Text(world.QueryPerceive("e2", "hearing", eventId: "ev7")));
        answers.Add(Text(world.TraceOf(eventId: "ev6", entity: null, field: null)));
        answers.Add(Text(world.TraceOf(eventId: null, entity: "e3", field: "contained_in")));
        answers.Add(Text(world.CatalogEntries()));
        answers.Add(Text(world.Check(new Command("probe", "e2", "take", Target: "lamp"))));
        answers.Add(Text(world.OptionsFor("e2", refused: false)));
        answers.Add(Text(world.Scheduled()));
        var history = (IWorldReads)world;
        var (deltas, events) = history.Since(0);
        answers.Add(Text(world.Heard(start, world.CurrentSnapshot(), events, ["e2"])));
        answers.Add(Text(world.Apply(new Command("observed", "e2", "say", Args: new Dictionary<string, JsonNode?> { ["utterance"] = "again" }), null, observe: true)));
        // One move a round, since the scenario has one actor; each round is numbered from the close before it.
        answers.Add(Text(world.TakeRoundAs([new Command("r1", "e2", "take", Target: "stone")])));
        answers.Add(Text(world.TakeRoundAs([new Command("r2", "e2", "say", Args: new Dictionary<string, JsonNode?> { ["utterance"] = "round" })])));
        answers.Add(Text(world.TakeRoundAs([new Command("r3", "e2", "drop", Target: "stone")])));
        answers.Add(Text(world.CurrentSnapshot()));
        (deltas, events) = history.Since(0);
        answers.Add(Text(deltas));
        answers.Add(Text(events));
        return answers;
    }

    private static string Text<T>(T value) => CanonicalJson.Serialize(JsonNode.Parse(WorldJson.Write(value)));

    private static List<string> Files(string root) =>
        Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)
            .ToList();

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
