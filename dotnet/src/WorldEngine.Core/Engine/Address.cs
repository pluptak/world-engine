using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The measured reach refusal data (src/engine/verbs/address.ts `reachData`): how far the target is from the actor,
// rounded up, and the actor's reach. Present only when both positions are known, the target shares the actor's room,
// and the reach is a number.
public sealed record ReachMeasure(long DistanceCm, double ReachCm);

// The reach and placement helpers of src/engine/verbs/address.ts that do not run a verb: the measured reach refusal
// data, and whether a placement would close a containment or support loop. `IsAgent`, `ClosedEnclosure` and the reach
// test itself are in `Reach`; the gap refusal is `Geometry.GapStopFor`.
public static class Address
{
    public static ReachMeasure? ReachData(Snapshot snapshot, string actorId, string targetId)
    {
        if (!snapshot.Entities.TryGetValue(actorId, out var actor) || !snapshot.Entities.TryGetValue(targetId, out var target))
        {
            return null;
        }
        var actorPos = Geometry.EffectivePos(snapshot, actorId);
        var targetPos = Geometry.EffectivePos(snapshot, targetId);
        var reach = PropValues.GetNumber(actor.Props, "reach_cm");
        if (actorPos is null || targetPos is null || target.Location != actor.Location || reach is null)
        {
            return null;
        }
        var dx = actorPos.X - targetPos.X;
        var dy = actorPos.Y - targetPos.Y;
        var distance = (long)Math.Ceiling(Math.Sqrt((double)(dx * dx + dy * dy)));
        return new ReachMeasure(distance, reach.Value);
    }

    // The reach refusal of a verb (src/engine/verbs/address.ts `refuseOutOfReach`): null when the target is in reach.
    public static Pipeline.Refusal? OutOfReach(Snapshot snapshot, string actorId, string targetId)
    {
        if (Reach.InReach(snapshot, actorId, targetId))
        {
            return null;
        }
        var measure = ReachData(snapshot, actorId, targetId);
        return new Pipeline.Refusal(
            Status.Refused,
            "out_of_reach",
            measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm)));
    }

    // A thing crossing a barrier between `from` and `to` must fit its gap (src/engine/verbs/address.ts `gapRefusal`):
    // refused `too_big_for_gap`, naming the barrier, the thing's smallest dimension and the gap.
    public static Pipeline.Refusal? GapRefusal(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string thingId,
        string fromId,
        string toId)
    {
        var stop = Geometry.GapStopFor(snapshot, registry, thingId, fromId, toId);
        return stop is null
            ? null
            : new Pipeline.Refusal(
                Status.Refused,
                "too_big_for_gap",
                Pipeline.Reason(("with", stop.With), ("size_cm", stop.SizeCm), ("gap_cm", stop.GapCm)));
    }

    // A placement may not close a containment or support loop: the item would hold what holds it.
    public static bool WouldLoop(Snapshot snapshot, string itemId, string destinationId)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = destinationId;
        while (current is not null)
        {
            if (current == itemId)
            {
                return true;
            }
            if (!visited.Add(current))
            {
                throw new InvalidOperationException($"Support or containment cycle at {current}");
            }
            if (!snapshot.Entities.TryGetValue(current, out var entity))
            {
                throw new InvalidOperationException($"Unknown entity {current}");
            }
            current = entity.ContainedIn ?? entity.Support;
        }
        return false;
    }
}
