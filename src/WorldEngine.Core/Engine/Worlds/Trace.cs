using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// Causes traced back through the log (src/engine/trace.ts): the chain of events an event came from, and the event that last set
// a field of an entity. Works on the events and deltas a log holds, and writes nothing.
public static class Trace
{
    // Every field an entity has, plus the pseudo-field `entity` that a spawn or removal's delta names (src/engine/trace.ts
    // `VALID_ENTITY_FIELDS`).
    public static readonly IReadOnlyList<string> ValidEntityFields =
    [
        "id", "template", "name", "aliases", "location", "support", "contained_in", "in_part", "concealed_by", "pos",
        "detached_from", "integrity", "status", "parts", "residue", "modifiers", "props", "traits", "entity",
    ];

    // The chain from the root event down to the start one, root first. A start event the log lacks, or a cause it names that
    // is missing, is refused.
    public static List<WorldEvent> Chain(IReadOnlyList<WorldEvent> events, string startEventId)
    {
        var byId = events.ToDictionary(@event => @event.EventId, StringComparer.Ordinal);
        if (!byId.TryGetValue(startEventId, out var start))
        {
            throw new WorldError(Code.NoSuchEvent, $"No such event {startEventId}");
        }
        var leafFirst = new List<WorldEvent> { start };
        var current = start;
        while (current.CauseId is { } causeId)
        {
            if (!byId.TryGetValue(causeId, out var parent))
            {
                throw new WorldError(Code.NoSuchEvent, $"No such event {causeId}");
            }
            leafFirst.Add(parent);
            current = parent;
        }
        leafFirst.Reverse();
        return leafFirst;
    }

    // The event that last set a field of an entity, or null when no delta does.
    public static string? FieldEventId(IReadOnlyList<Delta> deltas, string entity, string field)
    {
        string? found = null;
        foreach (var delta in deltas)
        {
            if (delta.Entity == entity && delta.Field == field)
            {
                found = delta.EventId;
            }
        }
        return found;
    }

    // The event that spawned an entity, from the delta that names it, or null.
    public static string? EntitySpawnEventId(IReadOnlyList<Delta> deltas, string entity) =>
        deltas.FirstOrDefault(delta => delta.Entity == entity && delta.Field == "entity")?.EventId;

    // The chain of the event named.
    public static List<WorldEvent> TraceEvent(IReadOnlyList<WorldEvent> events, string eventId) => Chain(events, eventId);

    // The chain of the event that last set a field of an entity, else of the event that spawned it, else nothing. A field no
    // entity has is refused.
    public static List<WorldEvent> TraceField(
        IReadOnlyList<WorldEvent> events,
        IReadOnlyList<Delta> deltas,
        string entity,
        string field)
    {
        if (!ValidEntityFields.Contains(field))
        {
            throw new WorldError(Code.NoSuchField, $"No such field {field}");
        }
        if (FieldEventId(deltas, entity, field) is { } start)
        {
            return Chain(events, start);
        }
        if (EntitySpawnEventId(deltas, entity) is { } spawned)
        {
            return Chain(events, spawned);
        }
        return [];
    }
}
