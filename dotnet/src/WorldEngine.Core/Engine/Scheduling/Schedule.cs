using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What the world will do by itself (src/engine/schedule.ts, src/engine/pending.ts): the pending causes, in run order. The
// `close` cause shuts a door or gate by itself; the `bleed` cause is a wound bleeding (`docs/bleeding.md`). The process,
// beat and remaining kinds are refused.
public static class Schedule
{
    private const long MaxSafeInteger = 9007199254740991;

    public static IReadOnlyList<ScheduledCause> Pending(Snapshot snapshot) => snapshot.Schedule ?? [];

    // What the world will do by itself that matches a filter, in run order: a read that changes nothing. `untilTick` keeps the
    // causes due at or before that tick (src/engine/pending.ts `scheduled`).
    public static List<ScheduledCause> Scheduled(Snapshot snapshot, string? kind = null, string? entity = null, long? untilTick = null) =>
        Pending(snapshot)
            .Where(cause => kind is null || cause.Kind == kind)
            .Where(cause => entity is null || cause.Entity == entity)
            .Where(cause => untilTick is null || cause.DueTick <= untilTick)
            .ToList();

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
    // already shut, the body already destroyed) does nothing and says nothing.
    public static void Run(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause)
    {
        switch (cause.Kind)
        {
            case "close":
                RunClose(working, registry, cause);
                return;
            case "bleed":
                RunBleed(working, registry, cause);
                return;
            case "process":
                Processes.RunProcess(working, registry, cause);
                return;
            case "beat":
                Beats.Run(working, registry, cause);
                return;
            default:
                throw new InvalidOperationException($"Unknown scheduled cause kind {cause.Kind}");
        }
    }

    private static void RunClose(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause)
    {
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

    // Each bleed names the one before it, back to the `detached` that opened the wound.
    private static void RunBleed(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause)
    {
        var entity = working.Snapshot.Entities.GetValueOrDefault(cause.Entity);
        var rule = entity is null ? null : Bleeding(entity.Props);
        if (entity is null || rule is null)
        {
            return;
        }
        var harm = Harm.Apply(working, registry, entity.Id, rule.Value.Damage, cause.CauseId);
        if (harm is { Destroyed: false })
        {
            ScheduleBleed(working, entity.Id, harm.EventId, (cause.Remaining ?? 0) - 1);
        }
    }

    // A lost part starts a wound of its own: the first bleed falls due `bleed_every_ticks` after the `detached` that opened
    // it, and two wounds bleed side by side (src/engine/schedule.ts `startBleeding`).
    public static void StartBleeding(Working working, string entityId, string detachedEvent)
    {
        var entity = working.Snapshot.Entities[entityId];
        if (Bleeding(entity.Props) is { } rule)
        {
            ScheduleBleed(working, entityId, detachedEvent, rule.Times);
        }
    }

    // The next bleed of a wound, due `bleed_every_ticks` on, while bleeds remain.
    private static void ScheduleBleed(Working working, string entityId, string causeId, long remaining)
    {
        var entity = working.Snapshot.Entities[entityId];
        var rule = Bleeding(entity.Props);
        var due = working.Snapshot.Tick + (rule?.Every ?? 0);
        if (rule is not null && remaining > 0 && Math.Abs(due) <= MaxSafeInteger)
        {
            Add(working, new ScheduledCause(due, "bleed", entityId, causeId, remaining));
        }
    }

    // A body's bleeding, read from its props when each bleed runs: so much integrity every so many ticks, so many times.
    // Any of the three missing or not a positive whole number, and it does not bleed.
    private static (long Damage, long Every, long Times)? Bleeding(IReadOnlyDictionary<string, JsonNode?> props)
    {
        static long? Read(IReadOnlyDictionary<string, JsonNode?> props, string name)
        {
            var value = PropValues.GetNumber(props, name);
            return value is { } number && Math.Floor(number) == number && number > 0 && number <= MaxSafeInteger
                ? (long)number
                : null;
        }
        var damage = Read(props, "bleed_damage");
        var every = Read(props, "bleed_every_ticks");
        var times = Read(props, "bleed_times");
        return damage is null || every is null || times is null ? null : (damage.Value, every.Value, times.Value);
    }
}
