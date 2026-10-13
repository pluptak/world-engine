using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// Containment, doors and reach (src/engine/verbs/address.ts): what a shut container keeps out of the world, which
// things an actor can reach by hand, and whether an entity is an agent that acts.
public static class Reach
{
    // Agency is declared, never inferred: a template says so, and a severed part is not the whole it came from.
    public static bool IsAgent(Snapshot snapshot, string id)
    {
        if (!snapshot.Entities.TryGetValue(id, out var entity))
        {
            throw new InvalidOperationException($"Unknown entity {id}");
        }
        return PropValues.IsTrue(entity.Props, "agent") && entity.DetachedFrom is null && entity.Status != EntityStatus.Destroyed;
    }

    // The first container up the containment chain that is shut: what is inside it is out of the world until it opens.
    public static string? ClosedEnclosure(Snapshot snapshot, string id)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = snapshot.Entities.TryGetValue(id, out var start) ? start.ContainedIn : null;
        while (current is not null)
        {
            if (!visited.Add(current))
            {
                throw new InvalidOperationException($"Containment cycle at {current}");
            }
            if (!snapshot.Entities.TryGetValue(current, out var entity))
            {
                throw new InvalidOperationException($"Unknown entity {current}");
            }
            if (PropValues.IsTrue(entity.Props, "openable") && !PropValues.IsTrue(entity.Props, "open"))
            {
                return current;
            }
            current = entity.ContainedIn;
        }
        return null;
    }

    // Whether a door's props join the two rooms, in either order. A missing room joins nothing.
    public static bool DoorJoins(IReadOnlyDictionary<string, JsonNode?> props, string? a, string? b)
    {
        if (a is null || b is null)
        {
            return false;
        }
        var from = PropValues.GetString(props, "from");
        var to = PropValues.GetString(props, "to");
        return (from == a && to == b) || (from == b && to == a);
    }

    // A doorway that joins the actor's room is reached from anywhere in it when it has no position, or when it stands
    // in the other room. In its own room a doorway keeps its position and the ordinary rule applies.
    public static bool ReachedAsDoor(Snapshot snapshot, string actorId, Entity entity)
    {
        var here = snapshot.Entities.TryGetValue(actorId, out var actor) ? actor.Location : null;
        var from = PropValues.GetString(entity.Props, "from");
        var to = PropValues.GetString(entity.Props, "to");
        return here is not null
            && from is not null
            && to is not null
            && (from == here || to == here)
            && (entity.Pos is null || entity.Location != here);
    }

    // The one reach rule: both positions known, the same room, and centre to centre within the actor's `reach_cm`.
    public static bool InReach(Snapshot snapshot, string actorId, string targetId)
    {
        if (!snapshot.Entities.TryGetValue(actorId, out var actor) || !snapshot.Entities.TryGetValue(targetId, out var target))
        {
            return false;
        }
        var actorPos = Geometry.EffectivePos(snapshot, actorId);
        var targetPos = Geometry.EffectivePos(snapshot, targetId);
        var reach = PropValues.GetNumber(actor.Props, "reach_cm");
        if (actorPos is null || targetPos is null || target.Location != actor.Location || reach is null)
        {
            return false;
        }
        double dx = actorPos.X - targetPos.X;
        double dy = actorPos.Y - targetPos.Y;
        return dx * dx + dy * dy <= reach.Value * reach.Value;
    }
}
