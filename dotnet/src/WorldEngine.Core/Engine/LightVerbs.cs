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
        Duration: _ => 1,
        OneTick: true,
        Requires: [new Pipeline.Requirement("manipulation", 50)],
        Transition: (working, context, rootEventId) => Transition(working, context, rootEventId, lit));

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context, bool lit)
    {
        var target = context.Target;
        if (target is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "missing_target");
        }
        // A part is not a thing to light, only the entity that declares it.
        if (target.Part is not null)
        {
            return new Pipeline.Refusal(Status.Refused, "target_attached");
        }
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var light))
        {
            return new Pipeline.Refusal(Status.Invalid, "no_such_entity");
        }
        if (!PropValues.IsTrue(light.Props, "light_source"))
        {
            return new Pipeline.Refusal(Status.Refused, "not_a_light");
        }
        var enclosure = Reach.ClosedEnclosure(snapshot, light.Id);
        if (enclosure is not null)
        {
            return new Pipeline.Refusal(Status.Refused, "container_closed", Pipeline.Reason(("enclosure", enclosure)));
        }
        if (Address.OutOfReach(snapshot, context.Command.Actor, light.Id) is { } reach)
        {
            return reach;
        }

        if (lit)
        {
            if (PropValues.IsTrue(light.Props, "burning"))
            {
                return new Pipeline.Refusal(Status.Refused, "already_burning");
            }
            // A light with a `fuel` prop needs some; one that declares none burns on its own.
            if (PropValues.GetNumber(light.Props, "fuel") is { } fuel && fuel <= 0)
            {
                return new Pipeline.Refusal(Status.Refused, "no_fuel");
            }
        }
        else if (!PropValues.IsTrue(light.Props, "burning"))
        {
            return new Pipeline.Refusal(Status.Refused, "not_burning");
        }
        return Pipeline.RequirementRefusal(context);
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string rootEventId, bool lit)
    {
        var lightId = context.Target!.EntityId;
        var light = working.Snapshot.Entities[lightId];
        var eventId = working.Emit(lit ? "lit" : "doused", lightId, new Dictionary<string, JsonNode?>(), rootEventId);
        var props = new Dictionary<string, JsonNode?>(light.Props, StringComparer.Ordinal)
        {
            ["burning"] = JsonValue.Create(lit),
        };
        working.SetProps(lightId, props, eventId);
    }
}
