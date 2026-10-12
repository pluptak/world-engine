using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The put verb (src/engine/verbs/put.ts): an actor sets a thing it holds on a surface (`on`), or into a container
// (`in`), or into one of its own pockets. Placing into a container needs hands, the verb's declared manipulation; a
// surface does not. Nothing else moves: the thing's relations change, and its position clears.
public static class PutVerb
{
    public static Pipeline.VerbDecl Put { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
        OneTick: true,
        Requires: [new Pipeline.Requirement("manipulation", 50)],
        Transition: Transition);

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var relation = RelationOf(context);
        var destinationText = Address.AddressText(context, "destination");
        if (relation is null || destinationText is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_args");
        }

        var target = context.Target;
        if (target is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "missing_target");
        }
        if (target.Part is not null)
        {
            return new Pipeline.Refusal(Status.Refused, "not_carried");
        }
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var item))
        {
            return new Pipeline.Refusal(Status.Invalid, "no_such_entity");
        }
        if (item.ContainedIn != context.Command.Actor)
        {
            return new Pipeline.Refusal(Status.Refused, "not_carried");
        }
        // Placing into a container needs hands; setting onto a surface does not.
        if (relation == "in" && Pipeline.RequirementRefusal(context) is { } capacity)
        {
            return capacity;
        }

        var resolution = Resolve.ResolveTarget(snapshot, context.Registry, context.Command.Actor, destinationText);
        switch (resolution)
        {
            case Resolve.Unresolved:
                return new Pipeline.Refusal(Status.Unresolved, null);
            case Resolve.Ambiguous ambiguous:
                return new Pipeline.Refusal(Status.Ambiguous, null, Candidates: ambiguous.Candidates);
            // A part is never a destination, with one exception: the actor's own space part stows a held item out of
            // the hands. Grips are filled by take, never by put.
            case Resolve.Resolved { Target.Part: not null } part:
                return StowRefusal(context, item, relation, part.Target.EntityId, part.Target.Part!);
        }

        var address = Address.AddressEntity(context, destinationText, "not_a_surface");
        return address.Failure ?? PlacementRefusal(context, item, address.Entity!, relation);
    }

    // The relation the verb places by, when the command names one of its two.
    private static string? RelationOf(Pipeline.CommandContext context)
    {
        var args = context.Command.Args;
        return args is not null && args.TryGetValue("relation", out var value) && value is JsonValue json
            && json.TryGetValue(out string? text) && text is "on" or "in"
            ? text
            : null;
    }

    // Stowing into the actor's own pocket: it must be a space part, the relation is `in`, and the item must fit it the
    // way it must fit a container.
    private static Pipeline.Refusal? StowRefusal(
        Pipeline.CommandContext context,
        Entity item,
        string relation,
        string holderId,
        string part)
    {
        var snapshot = context.Snapshot;
        var holder = snapshot.Entities.GetValueOrDefault(holderId);
        var holds = holder is null
            ? null
            : context.Registry.GetValueOrDefault(holder.Template)?.Parts.FirstOrDefault(decl => decl.Name == part)?.Holds;
        if (holderId != context.Command.Actor || holds?.Kind != "space" || relation != "in")
        {
            return new Pipeline.Refusal(Status.Refused, "not_a_surface");
        }
        return Carry.SpaceRefusal(snapshot, context.Registry, holderId, part, item);
    }

    // Whether the destination takes the item in the relation (src/engine/verbs/put.ts `placementRefusal`): the reach,
    // gap and loop rules first, then what the relation asks of a surface or a container.
    private static Pipeline.Refusal? PlacementRefusal(
        Pipeline.CommandContext context,
        Entity item,
        Entity destination,
        string relation)
    {
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        if (Address.WouldLoop(snapshot, item.Id, destination.Id))
        {
            return new Pipeline.Refusal(Status.Refused, "circular_placement");
        }
        if (Address.OutOfReach(snapshot, actorId, destination.Id) is { } reach)
        {
            return reach;
        }
        if (Address.GapRefusal(snapshot, context.Registry, item.Id, actorId, destination.Id) is { } gap)
        {
            return gap;
        }

        if (relation == "on")
        {
            if (!PropValues.IsTrue(destination.Props, "surface"))
            {
                return new Pipeline.Refusal(Status.Refused, "not_a_surface");
            }
            var enclosure = Reach.ClosedEnclosure(snapshot, destination.Id);
            if (enclosure is not null)
            {
                return new Pipeline.Refusal(Status.Refused, "container_closed", Pipeline.Reason(("enclosure", enclosure)));
            }
            var size = context.Registry[item.Template].SizeCm;
            var footprint = context.Registry[destination.Template].SizeCm;
            return TooLarge(Fit.Misfit([size.W, size.D], [footprint.W, footprint.D]));
        }

        if (!PropValues.IsTrue(destination.Props, "container"))
        {
            return new Pipeline.Refusal(Status.Refused, "not_a_container");
        }
        var shut = PropValues.IsTrue(destination.Props, "openable") && !PropValues.IsTrue(destination.Props, "open");
        var closed = shut ? destination.Id : Reach.ClosedEnclosure(snapshot, destination.Id);
        if (closed is not null)
        {
            return new Pipeline.Refusal(Status.Refused, "container_closed", Pipeline.Reason(("enclosure", closed)));
        }
        // No inner dimensions to report a space against, so the refusal carries no data.
        var inner = Fit.InnerDimensions(destination.Props);
        if (inner is null)
        {
            return new Pipeline.Refusal(Status.Refused, "too_large");
        }
        var itemSize = context.Registry[item.Template].SizeCm;
        return TooLarge(Fit.Misfit([itemSize.W, itemSize.D, itemSize.H], inner));
    }

    // A thing that overflows a space or a surface is refused `too_large`, naming the dimensions that overflowed.
    private static Pipeline.Refusal? TooLarge((double ItemCm, double SpaceCm)? misfit) =>
        misfit is { } data
            ? new Pipeline.Refusal(Status.Refused, "too_large", Pipeline.Reason(("item_cm", data.ItemCm), ("space_cm", data.SpaceCm)))
            : null;

    // The placement the verb makes (src/engine/verbs/put.ts `transition`): a pocket is the holder's, else the item
    // is inside or on the destination, and its position clears either way.
    private static void Transition(Working working, Pipeline.CommandContext context, string rootEventId)
    {
        var targetId = context.Target!.EntityId;
        var actorId = context.Command.Actor;
        var relation = RelationOf(context)!;
        var destinationText = Address.AddressText(context, "destination")!;
        var current = context with { Snapshot = working.Snapshot };

        if (Resolve.ResolveTarget(current.Snapshot, current.Registry, actorId, destinationText) is not Resolve.Resolved resolved)
        {
            throw new InvalidOperationException("Put destination changed after validation");
        }
        var moved = working.Emit("moved", targetId, Pipeline.Reason(("relation", relation)), rootEventId);
        if (resolved.Target.Part is { } part)
        {
            working.SetRelation(targetId, "contained_in", actorId, moved);
            working.SetRelation(targetId, "in_part", part, moved);
            working.SetRelation(targetId, "support", null, moved);
            working.SetPos(targetId, null, moved);
            return;
        }

        var address = Address.AddressEntity(current, destinationText, "not_a_surface");
        if (address.Entity is not { } destination)
        {
            throw new InvalidOperationException("Put destination changed after validation");
        }
        var onSurface = relation == "on";
        working.SetRelation(targetId, "contained_in", onSurface ? null : destination.Id, moved);
        working.SetRelation(targetId, "in_part", null, moved);
        working.SetRelation(targetId, "support", onSurface ? destination.Id : null, moved);
        working.SetPos(targetId, null, moved);
    }
}
