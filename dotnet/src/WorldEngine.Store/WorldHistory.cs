using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// The reads over a world's history (src/store/file-store.ts `since` and `attempts`): what every accepted command after a version did,
// and every submission decided at or after it, ok or not. Both read the log and the current version, and neither writes. Replays start
// from initial.json; the TypeScript store starts from its newest checkpoint instead, which gives the same answer, only sooner, and
// checkpoints come with the write path.
public static class WorldHistory
{
    // The deltas and events of every accepted command decided at `version` or later, in command order.
    public static (List<Delta> Deltas, List<WorldEvent> Events) Since(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        CheckVersion(dir, version, registry);

        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        var deltas = new List<Delta>();
        var events = new List<WorldEvent>();
        var entries = WorldFiles.ReadLog(dir);
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new WorldError("replay_diverges", $"Accepted command failed during replay at line {index + 1}");
            }
            // Collected by the version the command was applied to, as the TypeScript store does.
            if (snapshot.Version >= version)
            {
                deltas.AddRange(result.Deltas);
                events.AddRange(result.Events);
            }
            snapshot = result.Snapshot;
        }
        return (deltas, events);
    }

    // Every submission decided at `version` or later, in the order it came, ok or not, read straight from the log.
    public static List<Attempt> Attempts(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        CheckVersion(dir, version, registry);
        return WorldFiles.ReadLog(dir).Where(entry => entry.Version >= version).ToList();
    }

    // The version must be a safe, non-negative integer and no later than the world's current one.
    private static void CheckVersion(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        if (version < 0 || version > MaxSafeInteger)
        {
            throw new WorldError("invalid_version", $"Invalid version {version}");
        }
        var current = Current(dir, registry);
        if (version > current.Version)
        {
            throw new WorldError("future_version", $"Version {version} is ahead of {current.Version}");
        }
    }

    // The chain of events behind one event, or behind the last change of an entity's field (`trace`, `docs/provenance.md`). An
    // entity the world has never had is refused before its field is looked at.
    public static List<WorldEvent> TraceOf(
        string dir,
        string? eventId,
        string? entity,
        string? field,
        IReadOnlyDictionary<string, Template> registry)
    {
        var current = Current(dir, registry);
        var events = WorldFiles.ReadEvents(dir);
        if (eventId is not null)
        {
            return WorldEngine.Core.Engine.Trace.TraceEvent(events, eventId);
        }
        var deltas = WorldFiles.ReadDeltas(dir);
        var known = current.Entities.ContainsKey(entity!)
            || deltas.Any(delta => delta.Entity == entity)
            || events.Any(@event => @event.Entity == entity);
        if (!known)
        {
            throw new WorldError("no_such_entity", $"No such entity {entity}");
        }
        return WorldEngine.Core.Engine.Trace.TraceField(events, deltas, entity!, field!);
    }

    // The current snapshot, from the files as they agree; a world whose files disagree is not settled here yet.
    private static Snapshot Current(string dir, IReadOnlyDictionary<string, Template> registry) =>
        WorldReplay.TrustedSnapshot(dir, registry)
        ?? throw new WorldError("store_unsettled", "The world's files disagree with its head; settling them is not ported yet");

    // The snapshots before and after the command that produced an event, and the events through that command (`replayUntilEvent`).
    // Replayed from initial.json; the TypeScript store may start from a checkpoint, with the same answer.
    public static (Snapshot Before, Snapshot After, List<WorldEvent> Events)? ReplayUntilEvent(
        string dir,
        string eventId,
        IReadOnlyDictionary<string, Template> registry)
    {
        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        var events = new List<WorldEvent>();
        var entries = WorldFiles.ReadLog(dir);
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var before = snapshot;
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new FormatException($"Accepted command failed during replay at line {index + 1}");
            }
            events.AddRange(result.Events);
            snapshot = result.Snapshot;
            if (result.Events.Any(@event => @event.EventId == eventId))
            {
                return (before, snapshot, events);
            }
        }
        return null;
    }

    // A perceive query on the stored world (`storeWorld` `query`): the entity form reads the present; the event form reads the world at
    // either end of the event's command, and an event the log does not hold is answered from the present with its stored events.
    public static Perception.Answer QueryPerceive(
        string dir,
        string observer,
        string sense,
        IReadOnlyDictionary<string, Template> registry,
        string? eventId = null,
        string? entity = null)
    {
        var current = Current(dir, registry);
        if (eventId is null)
        {
            return Perception.Perceive(current, registry, observer, entity!, sense);
        }
        if (ReplayUntilEvent(dir, eventId, registry) is { } atEvent)
        {
            return Queries.AtEvent(atEvent.Before, atEvent.After, registry, atEvent.Events, observer, eventId, sense);
        }
        return EventPerception.Perceive(current, registry, WorldFiles.ReadEvents(dir), observer, eventId, sense);
    }

    private const long MaxSafeInteger = 9007199254740991;
}
