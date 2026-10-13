using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The drop verb (src/engine/verbs/drop.ts): an actor lets go of a thing it holds in a grip, and it falls from the hand
// onto whatever surface is under it, or to the floor. `DropCarriedItem` is the placement any verb uses to put a held
// thing down, and the fall that follows (breaking or spilling) is `Physical.ResolveDropFall`.
public static class DropVerb
{
    public static Pipeline.VerbDecl Drop { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
        OneTick: true,
        Transition: Transition);

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "missing_target");
        }
        if (target.Part is not null)
        {
            return new Pipeline.Refusal(Status.Refused, "not_carried");
        }
        if (!context.Snapshot.Entities.TryGetValue(target.EntityId, out var entity))
        {
            return new Pipeline.Refusal(Status.Invalid, "no_such_entity");
        }
        var actor = context.Snapshot.Entities[context.Command.Actor];
        if (entity.ContainedIn != actor.Id)
        {
            return new Pipeline.Refusal(Status.Refused, "not_carried");
        }
        // A drop leaves from a grip; what sits in a space part (pocket) is taken out first.
        if (Carry.InSpacePart(context.Registry, actor, entity))
        {
            return new Pipeline.Refusal(Status.Refused, "not_in_hand");
        }
        return null;
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId) =>
        DropCarriedItem(working, context.Registry, context.Command.Actor, context.Target!.EntityId, rootEventId);

    // Puts a thing a holder carries down: it falls from the holder's hand height onto the surface under the holder's
    // point, or to the floor. Returns the `dropped` event's id.
    public static string DropCarriedItem(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string holderId,
        string entityId,
        string? causeId)
    {
        var snapshot = working.Snapshot;
        var holder = snapshot.Entities[holderId];
        var entity = snapshot.Entities[entityId];
        var handHeight = PropValues.GetNumber(holder.Props, "hand_height_cm") ?? 0;
        // Where the holder is, through whatever carries it in turn: a carried agent drops from its carrier's place.
        var at = Geometry.EffectivePos(snapshot, holderId);
        var rest = holder.Location is not null && at is not null
            ? RestingPlace(snapshot, registry, holder.Location, at, handHeight, entityId, [holderId])
            : null;
        var fallCm = handHeight - (rest?.HeightCm ?? 0);

        var dropped = working.Emit("dropped", entityId, Pipeline.Reason(("fall_cm", fallCm)), causeId);
        working.SetRelation(entityId, "contained_in", null, dropped);
        working.SetRelation(entityId, "in_part", null, dropped);
        working.SetRelation(entityId, "support", rest?.Support ?? holder.Location, dropped);
        working.SetPos(entityId, rest is null ? at : null, dropped);
        Physical.ResolveDropFall(working, registry, entityId, dropped, fallCm);
        return dropped;
    }

    // What a resting place is: the surface a falling thing comes to rest on, and its height.
    public sealed record Resting(string Support, long HeightCm);

    // The tallest surface standing in the room that holds the point (compared on doubled coordinates) lower than the
    // height the faller falls from, at least as wide and deep as the faller (src/resolvers/physical.ts `restingPlace`).
    // The faller and whatever it fell from are not candidates; ties go to the first id in order.
    public static Resting? RestingPlace(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string roomId,
        Pos point,
        double fromCm,
        string faller,
        IReadOnlyList<string> exclude)
    {
        var fallerTemplate = registry[snapshot.Entities[faller].Template];
        Resting? best = null;
        foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            var entity = snapshot.Entities[id];
            if (!registry.TryGetValue(entity.Template, out var template)
                || id == faller
                || exclude.Contains(id)
                || entity.Support != roomId
                || entity.ContainedIn is not null
                || entity.Pos is null
                || entity.Status == EntityStatus.Destroyed
                || !PropValues.IsTrue(entity.Props, "surface")
                || template.SizeCm.H >= fromCm
                || template.SizeCm.W < fallerTemplate.SizeCm.W
                || template.SizeCm.D < fallerTemplate.SizeCm.D)
            {
                continue;
            }
            if (2 * Math.Abs(point.X - entity.Pos.X) >= template.SizeCm.W
                || 2 * Math.Abs(point.Y - entity.Pos.Y) >= template.SizeCm.D)
            {
                continue;
            }
            if (best is null || template.SizeCm.H > best.HeightCm)
            {
                best = new Resting(id, template.SizeCm.H);
            }
        }
        return best;
    }
}
