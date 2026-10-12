using WorldEngine.Core.Model;

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
