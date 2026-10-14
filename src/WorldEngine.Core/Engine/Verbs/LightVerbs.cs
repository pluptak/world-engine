using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The light and douse verbs (src/engine/verbs/light.ts): an actor strikes a flame in a light source, or pinches one
// out. Both need hands and reach, and neither works on a thing that is shut in a container. Lighting writes `burning`
// under a `lit` event, dousing under `doused`; whether a room is lit is read, never stored.
public static class LightVerbs
{
    public static Pipeline.VerbDecl Light { get; } = Declare(lit: true);

    public static Pipeline.VerbDecl Douse { get; } = Declare(lit: false);

    private static Pipeline.VerbDecl Declare(bool lit) => new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: context => Preconditions(context, lit),
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: (working, context, rootEventId) => Transition(working, context, rootEventId, lit));

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context, bool lit)
    {
        var target = context.Target;
        if (target is null)
        {
            return Pipeline.Invalid(Code.MissingTarget);
        }
        // A part is not a thing to light, only the entity that declares it.
        if (target.Part is not null)
        {
            return Pipeline.Refused(Code.TargetAttached);
        }
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var light))
        {
            return Pipeline.Invalid(Code.NoSuchEntity);
        }
        if (!light.Props.Is(Prop.LightSource))
        {
            return Pipeline.Refused(Code.NotALight);
        }
        var enclosure = Reach.ClosedEnclosure(snapshot, light.Id);
        if (enclosure is not null)
        {
            return Pipeline.Refused(Code.ContainerClosed, Pipeline.Reason(("enclosure", enclosure)));
        }
        if (Address.OutOfReach(snapshot, context.Command.Actor, light.Id) is { } reach)
        {
            return reach;
        }

        if (lit)
        {
            if (light.Props.Is(Prop.Burning))
            {
                return Pipeline.Refused(Code.AlreadyBurning);
            }
            // A light with a `fuel` prop needs some; one that declares none burns on its own.
            if (light.Props.Get(Prop.Fuel) is { } fuel && fuel <= 0)
            {
                return Pipeline.Refused(Code.NoFuel);
            }
        }
        else if (!light.Props.Is(Prop.Burning))
        {
            return Pipeline.Refused(Code.NotBurning);
        }
        return Pipeline.RequirementRefusal(context);
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId, bool lit)
    {
        var lightId = context.Target!.EntityId;
        var light = working.Snapshot.Entities[lightId];
        var eventId = working.Emit(lit ? EventType.Lit : EventType.Doused, lightId, new Dictionary<string, JsonNode?>(), rootEventId);
        working.SetProps(lightId, light.Props.With(Prop.Burning, lit), eventId);
    }
}
