using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The search verb (src/engine/verbs/search.ts): a look underneath a thing the actor can reach. It changes no state;
// each thing the target hides is `found`, in id order, and the world keeps no record of who looked.
public static class SearchVerbs
{
    public static Pipeline.VerbDecl Search { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: Transition);

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return Pipeline.Invalid(Code.MissingTarget);
        }
        // A part is not a thing to search under, only the entity that declares it.
        if (target.Part is not null)
        {
            return Pipeline.Refused(Code.TargetAttached);
        }
        if (!context.Snapshot.Entities.ContainsKey(target.EntityId))
        {
            return Pipeline.Invalid(Code.NoSuchEntity);
        }
        var enclosure = Reach.ClosedEnclosure(context.Snapshot, target.EntityId);
        if (enclosure is not null)
        {
            return Pipeline.Refused(Code.ContainerClosed, Pipeline.Reason(("enclosure", enclosure)));
        }
        if (!Reach.InReach(context.Snapshot, context.Command.Actor, target.EntityId))
        {
            var measure = Address.ReachData(context.Snapshot, context.Command.Actor, target.EntityId);
            return new Pipeline.Refusal(
                Status.Refused,
                Code.OutOfReach,
                measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm)));
        }
        return Pipeline.RequirementRefusal(context);
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var concealer = context.Target!.EntityId;
        foreach (var id in Concealment.HiddenBy(working.Snapshot, concealer))
        {
            working.Emit(EventType.Found, id, Pipeline.Reason(("concealer", concealer)), rootEventId);
        }
    }
}
