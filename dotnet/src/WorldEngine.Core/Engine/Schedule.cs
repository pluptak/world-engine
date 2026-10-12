using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What the world will do by itself (src/engine/schedule.ts, src/engine/pending.ts): the pending causes, in run order. Only
// the `close` cause is ported: a door or gate that shuts by itself. The bleed, process and beat causes are refused.
public static class Schedule
{
    public static IReadOnlyList<ScheduledCause> Pending(Snapshot snapshot) => snapshot.Schedule ?? [];

    // A new cause goes after every cause due at or before its tick, so two due together run in the order they were scheduled.
    public static void Add(Working working, ScheduledCause cause)
    {
        var list = Pending(working.Snapshot).ToList();
        var at = list.FindIndex(entry => entry.DueTick > cause.DueTick);
        list.Insert(at == -1 ? list.Count : at, cause);
        Replace(working, list);
    }

    // Withdrawn at the source, recording nothing: a door shut by hand has no close left to come.
    public static void Cancel(Working working, string kind, string entity)
    {
        var list = Pending(working.Snapshot);
        var kept = list.Where(entry => entry.Kind != kind || entry.Entity != entity).ToList();
        if (kept.Count != list.Count)
        {
            Replace(working, kept);
        }
    }

    // A cause whose entity is gone has nothing left to act on; it goes with the entity.
    public static void Prune(Working working)
    {
        var list = Pending(working.Snapshot);
        var kept = list.Where(entry => working.Snapshot.Entities.ContainsKey(entry.Entity)).ToList();
        if (kept.Count != list.Count)
        {
            Replace(working, kept);
        }
    }

    // Replaces the pending list; an empty one is stored as no field at all.
    public static void Replace(Working working, IReadOnlyList<ScheduledCause> list) => working.SetSchedule(list);

    // Runs one due cause, already taken off the schedule, at the current tick. A cause the world has overtaken (the door
    // already shut) does nothing and says nothing.
    public static void Run(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause)
    {
        if (cause.Kind != "close")
        {
            throw new NotPortedException($"scheduled {cause.Kind} causes");
        }
        var entity = working.Snapshot.Entities.GetValueOrDefault(cause.Entity);
        if (entity is null || !PropValues.IsTrue(entity.Props, "openable") || !PropValues.IsTrue(entity.Props, "open"))
        {
            return;
        }
        var closed = working.Emit("closed", entity.Id, new Dictionary<string, JsonNode?>(), cause.CauseId);
        // A door on its way shut has `closing` no longer, once it is shut.
        var props = new Dictionary<string, JsonNode?>(entity.Props, StringComparer.Ordinal);
        props.Remove("closing");
        props["open"] = JsonValue.Create(false);
        working.SetProps(entity.Id, props, closed);
        Gate.PushOccupantsAside(working, registry, entity.Id, closed);
    }
}
