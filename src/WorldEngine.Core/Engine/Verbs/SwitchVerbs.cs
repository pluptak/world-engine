using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The switch verbs (src/engine/verbs/switch.ts): an actor turns a power source, or a link toward one, on or off, by hand
// or from afar when its control walk ends at the actor. Flipping takes hands, as turning a key does, and a remote flip is
// refused only by what the walk meets on the way.
public static class SwitchVerbs
{
    public static Pipeline.VerbDecl SwitchOn { get; } = Declare(on: true);

    public static Pipeline.VerbDecl SwitchOff { get; } = Declare(on: false);

    private static Pipeline.VerbDecl Declare(bool on) => new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: context => Preconditions(context, on),
        Duration: _ => 1,
        OneTick: true,
        Requires: [new Pipeline.Requirement("manipulation", 50)],
        Transition: (working, context, rootEventId) => Transition(working, context, rootEventId, on));

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context, bool on)
    {
        var target = context.Target;
        if (target is null)
        {
            return Pipeline.Invalid("missing_target");
        }
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var entity))
        {
            return Pipeline.Invalid("no_such_entity");
        }
        if (!entity.Props.Is(Prop.PowerSource) && entity.Props.Get(Prop.PoweredBy) is null)
        {
            return Pipeline.Refused("not_switchable");
        }

        var remote = Remote.WorksRemotely(context, entity);
        if (!remote && !Remote.DeviceInReach(context, entity))
        {
            var measure = Address.ReachData(snapshot, context.Command.Actor, entity.Id);
            return new Pipeline.Refusal(
                Status.Refused,
                "out_of_reach",
                measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm)));
        }

        // Flipping a switch already that way would change nothing but the clock. A switch with no `on` is on.
        if (on && entity.Props.Get(Prop.On) != false)
        {
            return Pipeline.Refused("already_on");
        }
        if (!on && entity.Props.Get(Prop.On) == false)
        {
            return Pipeline.Refused("already_off");
        }

        if (remote)
        {
            // A link switched off has no power of its own, so a walk through it would refuse the very command that switches
            // it back on: `switch_on` judges the walk as it would carry the command, the link on.
            var judged = on ? WithoutOn(snapshot, entity) : snapshot;
            return Remote.RemoteFaultFor(context, entity, judged) is { } fault
                ? new Pipeline.Refusal(Status.Refused, fault.ReasonCode, fault.ReasonData)
                : null;
        }
        return Pipeline.RequirementRefusal(context);
    }

    // The snapshot with the entity's `on` prop taken away, so the walk is judged as a switch on would leave it.
    private static Snapshot WithoutOn(Snapshot snapshot, Entity entity)
    {
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal)
        {
            [entity.Id] = entity with { Props = entity.Props.Without(Prop.On) },
        };
        return snapshot with { Entities = entities };
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId, bool on)
    {
        var targetId = context.Target!.EntityId;
        var entity = working.Snapshot.Entities[targetId];
        var eventId = working.Emit("switched", targetId, Pipeline.Reason(("on", on)), rootEventId);
        working.SetProps(targetId, entity.Props.With(Prop.On, on), eventId);
    }
}
