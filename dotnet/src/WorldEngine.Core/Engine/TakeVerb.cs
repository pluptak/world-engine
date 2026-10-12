using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The take verb (src/engine/verbs/take.ts): an actor picks a thing up into a grip (or a pocket it was in) and nothing
// else changes but what the lifting uncovers. Its checks read the carry rules, the reach and the enclosure of the item.
public static class TakeVerb
{
    public static Pipeline.VerbDecl Take { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
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
            return new Pipeline.Refusal(Status.Refused, "target_attached");
        }
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var entity))
        {
            return new Pipeline.Refusal(Status.Invalid, "no_such_entity");
        }

        // Taking oneself, or whatever holds one up, would hold the taker inside what it took.
        if (Address.WouldLoop(snapshot, entity.Id, actorId))
        {
            return new Pipeline.Refusal(Status.Refused, "circular_placement");
        }
        if (Address.OutOfReach(snapshot, actorId, entity.Id) is { } reach)
        {
            return reach;
        }
        if (Address.GapRefusal(snapshot, context.Registry, entity.Id, entity.Id, actorId) is { } gap)
        {
            return gap;
        }

        // Already in the grip it would be put in: the take would change nothing but the clock, so it is said before
        // the carry check counts the item against itself (a full mouth is not the answer).
        if (entity.ContainedIn == actorId && Carry.PlaceInGrip(context, actorId, entity) is GripPlaced placed && placed.Part == entity.InPart)
        {
            return new Pipeline.Refusal(Status.Refused, "already_held");
        }

        var carry = Carry.Check(
            Capacities.All(snapshot, context.Registry, actorId),
            snapshot.Entities[actorId].Props,
            entity,
            context.Registry,
            Carry.HeldCount(snapshot, actorId),
            Carry.Alternatives,
            Carry.HandsHeldMass(snapshot, context.Registry, actorId, entity.Id));
        if (!carry.Ok)
        {
            return new Pipeline.Refusal(Status.Refused, carry.ReasonCode ?? "uncarryable", carry.ReasonData);
        }
        switch (Carry.PlaceInGrip(context, actorId, entity))
        {
            case GripInvalid invalid:
                return new Pipeline.Refusal(Status.Invalid, invalid.ReasonCode);
            case GripBlocked blocked:
                return new Pipeline.Refusal(Status.Refused, blocked.ReasonCode, blocked.ReasonData);
        }

        if (entity.ContainedIn is { } holderId && holderId != actorId)
        {
            if (!snapshot.Entities.TryGetValue(holderId, out var holder))
            {
                return new Pipeline.Refusal(Status.Invalid, "no_such_entity");
            }
            var enclosure = Reach.ClosedEnclosure(snapshot, entity.Id);
            if (enclosure is not null)
            {
                return new Pipeline.Refusal(Status.Refused, "container_closed", Pipeline.Reason(("enclosure", enclosure)));
            }
            // Only an agent holds: a container or a piece of furniture keeps what is inside it, and what it keeps is
            // there to be taken out. A pocket is just a container: taking from another agent's space part is allowed,
            // from a grip refused.
            if (Reach.IsAgent(snapshot, holder.Id))
            {
                var spaces = Carry.HolderLayout(context.Registry, holder.Template).Spaces.Select(space => space.Name).ToList();
                if (entity.InPart is null || !spaces.Contains(entity.InPart))
                {
                    return new Pipeline.Refusal(Status.Refused, "held_by_another");
                }
            }
        }
        return null;
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string rootEventId)
    {
        var actorId = context.Command.Actor;
        var targetId = context.Target!.EntityId;
        var entity = working.Snapshot.Entities[targetId];
        if (Carry.PlaceInGrip(context, actorId, entity) is not GripPlaced grip)
        {
            throw new InvalidOperationException("Take grip changed after validation");
        }

        var moved = working.Emit("moved", targetId, new Dictionary<string, JsonNode?>(), rootEventId);
        working.SetRelation(targetId, "contained_in", actorId, moved);
        working.SetRelation(targetId, "in_part", grip.Part, moved);
        working.SetRelation(targetId, "support", null, moved);
        working.SetPos(targetId, null, moved);
        // Lifting a thing uncovers whatever it was hiding and takes it out from under whatever hid it.
        Concealment.RevealConcealed(working, targetId, moved);
    }
}
