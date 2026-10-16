using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Time passing (src/engine/clock.ts `advanceClock`, for modifiers alone): the clock steps from the command's tick
// through every tick at which a modifier expires, then ends at tick + ticks. At each such tick the modifiers due
// expire, in (entity, capacity, cause, order) order, each `capability_changed` naming the modifier's cause; then the
// scheduled causes due run in schedule order (`Schedule`). A `stop` beat ends the time one tick short of its own tick
// while it is still pending there (src/engine/clock.ts `stopLimit`).
public static class Clock
{
    private sealed record Expiring(string Entity, Modifier Modifier, int Order);

    // The beat `advance` stops before: its id, and the tick it falls due at when the command is decided.
    public sealed record StopBeat(string Id, long DueTick);

    // With `wake` (agent ids), the clock ends early at the first tick whose events one of them could sense, after everything
    // due at that tick has run (src/engine/clock.ts `advanceClock`). Returns the ticks that passed.
    public static long Advance(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        long ticks,
        IReadOnlyList<string>? wake = null,
        StopBeat? stop = null)
    {
        var startTick = working.Snapshot.Tick;
        var endTick = startTick + ticks;
        // The limit is read again each time: a cause that runs can schedule or cancel the stop beat.
        long Limit() => Math.Min(endTick, StopLimit(working.Snapshot, stop));
        for (var due = NextDue(working.Snapshot, Limit()); due is not null; due = NextDue(working.Snapshot, Limit()))
        {
            var before = working.Snapshot;
            var firstNew = working.Events.Count;
            working.SetTick(due.Value);
            ExpireAt(working, registry, due.Value);
            // A cause due at this tick runs after the modifiers that expire here, each taken off the schedule first.
            for (var cause = Schedule.Pending(working.Snapshot).FirstOrDefault();
                cause is not null && cause.DueTick == due.Value;
                cause = Schedule.Pending(working.Snapshot).FirstOrDefault())
            {
                Schedule.Replace(working, [.. Schedule.Pending(working.Snapshot).Skip(1)]);
                var mark = working.Deltas.Count;
                Schedule.Run(working, registry, cause);
                Processes.ReconcileSince(working, registry, mark);
                Schedule.Prune(working);
            }
            if (wake is { Count: > 0 } && working.Events.Count > firstNew
                && EventPerception.SensedBy(before, working.Snapshot, registry, working.Events, [.. working.Events.Skip(firstNew)], wake))
            {
                return due.Value - startTick;
            }
        }
        var reached = Limit();
        working.SetTick(reached);
        return reached - startTick;
    }

    // One tick short of the stop beat's tick while that same run is still pending there. Once it has run, or has been cancelled
    // or pruned, nothing stops the clock; a repeat's later run is a different tick, so it does not.
    private static long StopLimit(Snapshot snapshot, StopBeat? stop)
    {
        if (stop is null)
        {
            return long.MaxValue;
        }
        var waiting = Schedule.Pending(snapshot).OfType<BeatCause>().Any(found => found.Id == stop.Id && found.DueTick == stop.DueTick);
        return waiting ? stop.DueTick - 1 : long.MaxValue;
    }

    // The first tick after `snapshot.Tick`, up to `until`, at which some modifier expires.
    private static long? NextDue(Snapshot snapshot, long until)
    {
        long? next = null;
        foreach (var entity in snapshot.Entities.Values)
        {
            foreach (var modifier in entity.Modifiers)
            {
                if (modifier.ExpiresAtTick is { } tick && tick > snapshot.Tick && tick <= until && (next is null || tick < next))
                {
                    next = tick;
                }
            }
        }
        var first = Schedule.Pending(snapshot).FirstOrDefault();
        if (first is not null && first.DueTick > snapshot.Tick && first.DueTick <= until && (next is null || first.DueTick < next))
        {
            next = first.DueTick;
        }
        return next;
    }

    private static void ExpireAt(Working working, IReadOnlyDictionary<string, Template> registry, long expirationTick)
    {
        var expiring = new List<Expiring>();
        foreach (var entityId in working.Snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            var modifiers = working.Snapshot.Entities[entityId].Modifiers;
            for (var order = 0; order < modifiers.Count; order++)
            {
                if (modifiers[order].ExpiresAtTick == expirationTick)
                {
                    expiring.Add(new Expiring(entityId, modifiers[order], order));
                }
            }
        }
        if (expiring.Count == 0)
        {
            return;
        }
        expiring = [.. expiring
            .OrderBy(entry => entry.Entity, StringComparer.Ordinal)
            .ThenBy(entry => entry.Modifier.Capacity, StringComparer.Ordinal)
            .ThenBy(entry => entry.Modifier.CauseId, StringComparer.Ordinal)
            .ThenBy(entry => entry.Order)];
        var affected = expiring.Select(entry => entry.Entity).Distinct().Order(StringComparer.Ordinal).ToList();

        // A modifier counts while its expiry is still ahead, so the tick before reads it in force.
        var lastTick = working.Snapshot with { Tick = expirationTick - 1 };
        var before = affected.ToDictionary(id => id, id => Capacities.All(lastTick, registry, id), StringComparer.Ordinal);

        var remaining = affected.ToDictionary(
            id => id,
            id => working.Snapshot.Entities[id].Modifiers
                .Where(modifier => modifier.ExpiresAtTick is null || modifier.ExpiresAtTick > expirationTick)
                .ToList(),
            StringComparer.Ordinal);
        var expiredEntities = new Dictionary<string, Entity>(working.Snapshot.Entities, StringComparer.Ordinal);
        foreach (var id in affected)
        {
            expiredEntities[id] = expiredEntities[id] with { Modifiers = remaining[id] };
        }
        var expired = working.Snapshot with { Entities = expiredEntities };
        var after = affected.ToDictionary(id => id, id => Capacities.All(expired, registry, id), StringComparer.Ordinal);

        // The events come first, so the change to `modifiers` is recorded under the entity's first expiry, which names
        // the modifier's cause: a trace of the field and of the event agree.
        var firstEvent = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in expiring)
        {
            var data = Pipeline.Reason(
                ("capacity", entry.Modifier.Capacity),
                ("from", Level(before[entry.Entity], entry.Modifier.Capacity)),
                ("to", Level(after[entry.Entity], entry.Modifier.Capacity)));
            var eventId = working.Emit(EventType.CapabilityChanged, entry.Entity, data, entry.Modifier.CauseId);
            firstEvent.TryAdd(entry.Entity, eventId);
        }
        foreach (var id in affected)
        {
            working.SetModifiers(id, remaining[id], firstEvent[id]);
        }
    }

    private static long Level(IReadOnlyDictionary<string, long>? capacities, string capacity) =>
        capacities is not null && capacities.TryGetValue(capacity, out var level) ? level : 0;
}
