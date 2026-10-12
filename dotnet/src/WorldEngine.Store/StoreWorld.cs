using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// A stored world behind the World's operations (src/api.ts `openWorld` and the methods of its World): the calls a memory world answers,
// over the files in one directory. The set is the world's own templates.json, read once when the world is opened. The answers are the
// same as a memory world's over the same history (`IWorld`, `IWorldDriver`, `IWorldReads`), which the conformance tests hold.
public sealed class StoreWorld : IWorld, IWorldDriver, IWorldReads
{
    private readonly string dir;
    private readonly IReadOnlyDictionary<string, Template> registry;
    private readonly int snapshotEvery;
    private readonly int checkpointEvery;

    // The players' pending moves, held by this handle (`src/internal.ts` `INTERNAL`'s `pending`), as a memory world holds its own.
    public IPendingMoves Pending { get; } = new MemoryPendingMoves();

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

    public IReadOnlyDictionary<string, Template> Registry => registry;

    // The current snapshot, settled under the turn when the files do not agree (`load`).
    public Snapshot CurrentSnapshot() => WorldSettle.Load(dir, registry);

    public Entity? EntityOf(string id) => CurrentSnapshot().Entities.GetValueOrDefault(id);

    // One command as the world takes it: a flagged one is refused as invalid, and with `observe` the actor's view after it is attached.
    public Pipeline.Result Apply(Command command, long? basedOn = null, bool observe = false)
    {
        if (WorldReads.IsFlagged(command))
        {
            return WorldReads.RoundFlagged(CurrentSnapshot(), command);
        }
        var result = WorldWriter.Submit(dir, registry, command, basedOn, snapshotEvery: snapshotEvery, checkpointEvery: checkpointEvery);
        return WorldReads.WithObservation(this, command.Actor, result, observe);
    }

    Pipeline.Result IWorldDriver.Apply(Command command, long? basedOn) => Apply(command, basedOn, observe: false);

    // An author edit, with `edit-<n>` as its id unless one is given (`edit`).
    public Pipeline.Result Edit(JsonObject edit, string? commandId = null, bool perceivers = false, By? by = null, long? basedOn = null) =>
        WorldEdits.Edit(dir, registry, edit, commandId, perceivers, by, basedOn, snapshotEvery: snapshotEvery, checkpointEvery: checkpointEvery);

    // What a command would get now, with nothing logged (`check`).
    public Pipeline.Result Check(Command command) => WorldReads.DryRun(registry, CurrentSnapshot(), command);

    public Options.Result OptionsFor(string actor, bool refused)
    {
        var current = CurrentSnapshot();
        return Options.List(current, registry, actor, refused, command => WorldReads.DryRun(registry, current, command));
    }

    // One observer's projection; with `since` or `sinceTick`, the events it sensed after that version or at that tick (`observe`).
    public JsonObject Observe(string observer, long? since = null, long? sinceTick = null) =>
        WorldReads.Observe(this, observer, since, sinceTick, tick => WorldFiles.ReadEvents(dir).Where(@event => @event.Tick >= tick).ToList());

    public JsonObject? Inspect(string observer, string entity) => WorldReads.Inspect(this, observer, entity);

    // The fact half of a query, judged on the current snapshot (`query` of a fact).
    public Perception.Answer QueryFact(string subject, string relation, string? obj) => Queries.Fact(CurrentSnapshot(), registry, subject, relation, obj);

    // A perceive, by entity (the present) or by an event (the world at either end of the event's command), by a sense (`query` of a perceive).
    public Perception.Answer QueryPerceive(string observer, string sense, string? eventId = null, string? entity = null) =>
        WorldHistory.QueryPerceive(dir, observer, sense, registry, eventId, entity);

    // Whether an observer sensed an event by a sense, as of the snapshot either side of the command that made it (event form of perceive).
    Perception.Answer IWorldReads.PerceiveAtEvent(string observer, string sense, string eventId) =>
        WorldHistory.QueryPerceive(dir, observer, sense, registry, eventId: eventId);

    // A round of this world, closed by the director: its moves are decided against the same world, and each refusal the plan makes is logged
    // with no part in the world (`docs/rounds.md`, `roundAs`).
    public Round.Outcome TakeRoundAs(IReadOnlyList<Command> moves)
    {
        var start = CurrentSnapshot();
        var plan = Round.PlanRound(start, registry, VerbRegistry.All, moves);
        if (plan.Status != Status.Ok)
        {
            return new Round.Outcome(plan.Status, plan.ReasonCode, null, [], null);
        }
        var closed = WorldFiles.ReadHead(dir)?.RoundsClosed ?? 0;
        return Round.Play(
            moves,
            plan,
            closed + 1,
            start.Version,
            (command, basedOn, mark, decided) => WorldWriter.Submit(
                dir,
                registry,
                command,
                basedOn ?? CurrentSnapshot().Version,
                mark,
                decided,
                snapshotEvery,
                checkpointEvery),
            new By(Role.Director));
    }

    // Whether one of the observers sensed one of the events between the snapshots (`heard`, `docs/roles.md`).
    public bool Heard(Snapshot before, Snapshot after, IReadOnlyList<WorldEvent> events, IReadOnlyList<string> observers) =>
        EventPerception.SensedBy(before, after, registry, events, events, observers);

    public IReadOnlyList<ScheduledCause> Scheduled() => Schedule.Scheduled(CurrentSnapshot());

    // The chain of events behind one event, or behind the last change of an entity's field (`trace`).
    public List<WorldEvent> TraceOf(string? eventId, string? entity, string? field) => WorldHistory.TraceOf(dir, eventId, entity, field, registry);

    // The verbs and the templates the world can name, as the catalog gives them.
    public IReadOnlyList<Catalog.CatalogEntry> CatalogEntries() => Catalog.Of(registry);

    // The deltas and events of every accepted command decided at `version` or later (`since`).
    public (List<Delta> Deltas, List<WorldEvent> Events) Since(long version) => WorldHistory.Since(dir, version, registry);

    // Every submission decided at `version` or later, ok or not (`attempts`).
    public IReadOnlyList<Attempt> Attempts(long version) => WorldHistory.Attempts(dir, version, registry);

    // Whether the log replays to exactly what the files hold (`verify`).
    public WorldVerify.Verification Verify() => WorldVerify.Verify(dir, registry);

    // The id a scenario gave a name (`id`), from ids.json; null when the world has no such name.
    public string? Id(string name) => WorldFiles.ReadIds(dir).TryGetValue(name, out var id) ? id : null;
}
