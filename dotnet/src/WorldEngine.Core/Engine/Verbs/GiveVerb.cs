using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The give verb (src/engine/verbs/give.ts): an actor hands a thing it holds to another agent, which takes it into a
// grip. The recipient's carry and grips decide, as they would for a take; the reach and gap rules are the actor's.
// Consent is not modelled: a character agent decides whether the recipient accepts.
public static class GiveVerb
{
    public static Pipeline.VerbDecl Give { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
        OneTick: true,
        Suggest: Suggest,
        Transition: Transition);

    // Each agent the actor can name, when the item is in its hand: all a give takes (src/engine/verbs/give.ts `suggest`).
    private static IReadOnlyList<JsonObject> Suggest(Pipeline.CommandContext context, IReadOnlyList<string> nameable)
    {
        var actor = context.Snapshot.Entities[context.Command.Actor];
        var item = context.Target is null ? null : context.Snapshot.Entities.GetValueOrDefault(context.Target.EntityId);
        if (item is null || item.ContainedIn != actor.Id || Carry.InSpacePart(context.Registry, actor, item))
        {
            return [];
        }
        return nameable
            .Where(id => id != item.Id && Reach.IsAgent(context.Snapshot, id))
            .Select(destination => new JsonObject { ["destination"] = destination })
            .ToList();
    }

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var destinationText = Address.AddressText(context, "destination");
        if (destinationText is null)
        {
            return Pipeline.Invalid("invalid_args");
        }

        var target = context.Target;
        if (target is null)
        {
            return Pipeline.Invalid("missing_target");
        }
        if (target.Part is not null)
        {
            return Pipeline.Refused("not_carried");
        }

        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var item))
        {
            return Pipeline.Invalid("no_such_entity");
        }
        if (item.ContainedIn != actorId)
        {
            return Pipeline.Refused("not_carried");
        }
        // An item in a pocket is taken out of it before it is given.
        if (Carry.InSpacePart(context.Registry, snapshot.Entities[actorId], item))
        {
            return Pipeline.Refused("not_in_hand");
        }

        var address = Address.AddressEntity(context, destinationText, "not_an_actor");
        if (address.Failure is { } failure)
        {
            return failure;
        }
        var recipient = address.Entity!;

        if (recipient.Id == actorId)
        {
            return Pipeline.Refused("cannot_give_to_self");
        }
        if (!Reach.IsAgent(snapshot, recipient.Id))
        {
            return Pipeline.Refused("not_an_actor");
        }
        if (Address.WouldLoop(snapshot, item.Id, recipient.Id))
        {
            return Pipeline.Refused("circular_placement");
        }
        if (Address.OutOfReach(snapshot, actorId, recipient.Id) is { } reach)
        {
            return reach;
        }
        if (Address.GapRefusal(snapshot, context.Registry, item.Id, actorId, recipient.Id) is { } gap)
        {
            return gap;
        }

        var carry = Carry.Check(
            Capacities.All(snapshot, context.Registry, recipient.Id),
            snapshot.Entities[recipient.Id].Props,
            item,
            context.Registry,
            Carry.HeldCount(snapshot, recipient.Id),
            Carry.Alternatives,
            Carry.HandsHeldMass(snapshot, context.Registry, recipient.Id, item.Id));
        if (!carry.Ok)
        {
            return new Pipeline.Refusal(Status.Refused, carry.ReasonCode ?? "uncarryable", carry.ReasonData);
        }
        switch (Carry.PlaceInGrip(context, recipient.Id, item))
        {
            case GripInvalid invalid:
                return new Pipeline.Refusal(Status.Invalid, invalid.ReasonCode);
            case GripBlocked blocked:
                return new Pipeline.Refusal(Status.Refused, blocked.ReasonCode, blocked.ReasonData);
        }
        return null;
    }

    // The item moves from the actor's hand into the recipient's grip. The grip is recomputed here, since the context
    // carries no verdict from the preconditions.
    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var actorId = context.Command.Actor;
        var targetId = context.Target!.EntityId;
        var destinationText = Address.AddressText(context, "destination")!;
        var current = context with { Snapshot = working.Snapshot };

        var address = Address.AddressEntity(current, destinationText, "not_an_actor");
        if (address.Entity is not { } recipient)
        {
            throw new InvalidOperationException("Give destination changed after validation");
        }
        var item = working.Snapshot.Entities[targetId];
        var moved = working.Emit(
            "moved",
            targetId,
            Pipeline.Reason(("from", actorId), ("to", recipient.Id)),
            rootEventId);
        if (Carry.PlaceInGrip(current, recipient.Id, item) is not GripPlaced grip)
        {
            throw new InvalidOperationException("Give grip changed after validation");
        }
        working.SetRelation(targetId, "contained_in", recipient.Id, moved);
        working.SetRelation(targetId, "in_part", grip.Part, moved);
    }
}
