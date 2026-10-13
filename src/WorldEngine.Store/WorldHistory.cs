using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Store;

// The reads over a world's history (src/store/file-store.ts `since`, `attempts`, `trace`, `replayUntilEvent`, and the stored perceive).
// They read the log and the files it keeps, and write nothing. A replay starts from the newest usable checkpoint (WorldCheckpoints), or
// from initial.json; the answer is the same either way.
public static class WorldHistory
{
    // The deltas and events of every accepted command decided at `version` or later, in command order.
    public static (List<Delta> Deltas, List<WorldEvent> Events) Since(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        CheckVersion(dir, version, registry);

        var start = WorldCheckpoints.ReplayStart(dir, registry, (candidate, _) => candidate <= version);
        var snapshot = start.Snapshot;
        var deltas = new List<Delta>();
        var events = new List<WorldEvent>();
        foreach (var (entry, line) in start.Entries)
        {
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new WorldError("replay_diverges", $"Accepted command failed during replay at line {line}");
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
        return [.. WorldFiles.ReadLog(dir).Where(entry => entry.Version >= version)];
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

    // The snapshots before and after the command that produced an event, and the events through that command (`replayUntilEvent`).
    // Event ids number the same counter as `next_seq`, so a checkpoint made before the command that wrote the event is usable; an id
    // that is not of that form starts from initial.json.
    public static (Snapshot Before, Snapshot After, List<WorldEvent> Events)? ReplayUntilEvent(
        string dir,
        string eventId,
        IReadOnlyDictionary<string, Template> registry)
    {
        var number = System.Text.RegularExpressions.Regex.Match(eventId, @"^ev(\d+)$");
        var start = WorldCheckpoints.ReplayStart(
            dir,
            registry,
            (_, next) => number.Success && next <= long.Parse(number.Groups[1].Value));
        var snapshot = start.Snapshot;
        var collected = new List<WorldEvent>();
        foreach (var (entry, line) in start.Entries)
        {
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var before = snapshot;
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new FormatException($"Accepted command failed during replay at line {line}");
            }
            collected.AddRange(result.Events);
            snapshot = result.Snapshot;
            if (result.Events.Any(@event => @event.EventId == eventId))
            {
                // From initial.json the collected events are every event through the command; from a checkpoint they are read from the
                // events file, which holds the ones before the checkpoint as well.
                return (before, snapshot, start.FromInitial ? collected : ThroughFromFile(dir, eventId) ?? collected);
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

    // The version must be a safe, non-negative integer and no later than the world's current one.
    private static void CheckVersion(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        if (version < 0)
        {
            throw new WorldError("invalid_version", $"Invalid version {version}");
        }
        var current = Current(dir, registry);
        if (version > current.Version)
        {
            throw new WorldError("future_version", $"Version {version} is ahead of {current.Version}");
        }
    }

    // The current snapshot, from the files as they agree; a world whose files disagree is settled first, under the world's turn.
    internal static Snapshot Current(string dir, IReadOnlyDictionary<string, Template> registry) => WorldSettle.Load(dir, registry);

    // Every event up to the end of the command that wrote the event, from the events file (`eventsThrough`). Null when the file does not
    // hold the event.
    private static List<WorldEvent>? ThroughFromFile(string dir, string eventId)
    {
        var stored = WorldFiles.ReadEvents(dir);
        var at = stored.FindIndex(@event => @event.EventId == eventId);
        if (at < 0)
        {
            return null;
        }
        var end = at;
        while (end + 1 < stored.Count && stored[end + 1].CommandId == stored[at].CommandId)
        {
            end += 1;
        }
        return stored.GetRange(0, end + 1);
    }

}
