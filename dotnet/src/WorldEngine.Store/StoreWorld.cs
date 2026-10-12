using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// A stored world behind the facade's operations (src/api.ts `openWorld` and the methods of its World): the same calls the memory world
// answers, over the files in one directory. The set is the world's own templates.json, read once when the world is opened.
public sealed class StoreWorld : IWorldDriver
{
    private readonly string dir;
    private readonly IReadOnlyDictionary<string, Template> registry;
    private readonly int snapshotEvery;
    private readonly int checkpointEvery;

    private StoreWorld(string dir, IReadOnlyDictionary<string, Template> registry, int snapshotEvery, int checkpointEvery)
    {
        this.dir = dir;
        this.registry = registry;
        this.snapshotEvery = snapshotEvery;
        this.checkpointEvery = checkpointEvery;
    }

    // `snapshotEvery` and `checkpointEvery` are the intervals the world writes its snapshot and checkpoint at (`openWorld`'s options).
    public static StoreWorld Open(string dir, int snapshotEvery = WorldWriter.SnapshotEvery, int checkpointEvery = WorldWriter.CheckpointEvery)
    {
        if (!WorldFiles.Exists(dir))
        {
            throw new WorldError("no_such_world", $"No world at {dir}");
        }
        return new StoreWorld(dir, WorldFiles.ReadTemplates(dir), snapshotEvery, checkpointEvery);
    }

    // The current snapshot, settled under the turn when the files do not agree (`load`).
    public Snapshot CurrentSnapshot() => WorldSettle.Load(dir, registry);

    // A command, decided against the world and logged whatever it said (`command`).
    public Pipeline.Result Apply(Command command, long? basedOn = null) => WorldWriter.Submit(dir, registry, command, basedOn, snapshotEvery: snapshotEvery, checkpointEvery: checkpointEvery);

    // An author edit, with `edit-<n>` as its id unless one is given (`edit`).
    public Pipeline.Result Edit(JsonObject edit, string? commandId = null, bool perceivers = false, By? by = null, long? basedOn = null) =>
        WorldEdits.Edit(dir, registry, edit, commandId, perceivers, by, basedOn, snapshotEvery: snapshotEvery, checkpointEvery: checkpointEvery);

    // The deltas and events of every accepted command decided at `version` or later (`since`).
    public (List<Delta> Deltas, List<WorldEvent> Events) Since(long version) => WorldHistory.Since(dir, version, registry);

    // Every submission decided at `version` or later, ok or not (`attempts`).
    public IReadOnlyList<Attempt> Attempts(long version) => WorldHistory.Attempts(dir, version, registry);

    // Whether the log replays to exactly what the files hold (`verify`).
    public WorldVerify.Verification Verify() => WorldVerify.Verify(dir, registry);

    // The id a scenario gave a name (`id`), from ids.json; null when the world has no such name.
    public string? Id(string name) => WorldFiles.ReadIds(dir).TryGetValue(name, out var id) ? id : null;
}
