using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The consume verb (src/engine/verbs/consume.ts): an actor eats a solid thing (`nutrition`, one portion at a time) or
// drinks an amount of a liquid (`liquid_nutrition` per 100 cm³ of what the vessel holds). Either lowers the actor's
// `hunger`, when it declares one. A solid thing's last portion uses the thing up, which is spendEntity's removal and is
// not ported, so it throws before anything is written.
public static class ConsumeVerb
{
    public static Pipeline.VerbDecl Consume { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
        Transition: Transition);

    // What one consume takes. A solid has its nutrition and its portions left (null when it is eaten whole); a liquid
    // has the amount taken, what the vessel held, its material and the nutrition the amount gives.
    private abstract record Plan;
    private sealed record SolidPlan(long Nutrition, long? Portions) : Plan;
    private sealed record LiquidPlan(long Amount, long Available, string Material, long Nutrition) : Plan;

    // The outcome of planning: the item and its plan, or the refusal that stopped it.
    private sealed record Choice(Entity? Item, Plan? Plan, Pipeline.Refusal? Refusal);

    private const long MaxSafeInteger = 9007199254740991;

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context) => Planned(context).Refusal;

    private static void Transition(Working working, Pipeline.CommandContext context, string rootEventId)
    {
        var actorId = context.Command.Actor;
        var choice = Planned(context with { Snapshot = working.Snapshot });
        if (choice.Refusal is not null || choice.Item is not { } item || choice.Plan is not { } taken)
        {
            throw new InvalidOperationException("Consume target changed after validation");
        }
        if (taken is SolidPlan { Portions: null or 1 })
        {
            throw new NotPortedException("eating the last portion of a thing, which uses it up");
        }

        var eaten = working.Emit("consumed", item.Id, ConsumedData(taken), rootEventId);

        // Only a body that declares a hunger has one to lower.
        var actor = working.Snapshot.Entities[actorId];
        var nutrition = taken is SolidPlan solid ? solid.Nutrition : ((LiquidPlan)taken).Nutrition;
        if (WholeNumber(actor.Props.GetValueOrDefault("hunger"), out var hunger))
        {
            var actorProps = new Dictionary<string, JsonNode?>(actor.Props, StringComparer.Ordinal)
            {
                ["hunger"] = JsonValue.Create(Math.Max(0, hunger - nutrition)),
            };
            working.SetProps(actorId, actorProps, eaten);
        }

        if (taken is SolidPlan { Portions: { } portions })
        {
            var props = new Dictionary<string, JsonNode?>(item.Props, StringComparer.Ordinal)
            {
                ["portions"] = JsonValue.Create(portions - 1),
            };
            working.SetProps(item.Id, props, eaten);
            return;
        }

        var liquid = (LiquidPlan)taken;
        var remaining = liquid.Available - liquid.Amount;
        // An emptied vessel declares no material at all, the way a poured or broken one does.
        var vessel = new Dictionary<string, JsonNode?>(item.Props, StringComparer.Ordinal)
        {
            ["liquid_amount"] = JsonValue.Create(remaining),
        };
        if (remaining == 0)
        {
            vessel["liquid_material"] = JsonValue.Create("");
        }
        working.SetProps(item.Id, vessel, eaten);
    }

    private static Dictionary<string, JsonNode?> ConsumedData(Plan taken) => taken switch
    {
        SolidPlan solid => new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
        {
            ["nutrition"] = JsonValue.Create(solid.Nutrition),
            ["portions_left"] = JsonValue.Create(solid.Portions!.Value - 1),
        },
        LiquidPlan liquid => new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
        {
            ["nutrition"] = JsonValue.Create(liquid.Nutrition),
            ["material"] = JsonValue.Create(liquid.Material),
            ["amount"] = JsonValue.Create(liquid.Amount),
        },
        _ => throw new InvalidOperationException("Unknown consume plan"),
    };

    private static Choice Planned(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return Refused(Status.Invalid, "missing_target");
        }
        if (target.Part is not null)
        {
            return Refused(Status.Refused, "not_consumable");
        }
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var item))
        {
            return Refused(Status.Invalid, "no_such_entity");
        }

        var chosen = PlanOf(item, context.Command.Args);
        if (chosen.Refusal is not null)
        {
            return chosen;
        }
        var enclosure = Reach.ClosedEnclosure(snapshot, item.Id);
        if (enclosure is not null)
        {
            return Refused(Status.Refused, "container_closed", Pipeline.Reason(("enclosure", enclosure)));
        }

        // What the actor carries is in reach by being carried, in a hand or a pocket; anything else is measured from
        // where the actor stands.
        var actorId = context.Command.Actor;
        if (item.ContainedIn != actorId && Address.OutOfReach(snapshot, actorId, item.Id) is { } reach)
        {
            return new Choice(null, null, reach);
        }
        if (MouthBusy(context, item.Id))
        {
            return Refused(Status.Refused, "mouth_full");
        }
        return chosen;
    }

    // What the item gives: a liquid when it holds some with a material, else a solid that declares nutrition. The amount
    // argument is a whole positive number for a liquid (absent takes all of it) and is not taken by a solid.
    private static Choice PlanOf(Entity item, IReadOnlyDictionary<string, JsonNode?>? args)
    {
        var material = PropValues.GetString(item.Props, "liquid_material");
        if (!string.IsNullOrEmpty(material)
            && WholeNumber(item.Props.GetValueOrDefault("liquid_amount"), out var available)
            && available > 0)
        {
            if (!WholeNumber(item.Props.GetValueOrDefault("liquid_nutrition"), out var perHundred) || perHundred < 0)
            {
                return Refused(Status.Refused, "not_consumable");
            }
            var requested = args is not null && args.ContainsKey("amount");
            long amount = available;
            if (requested && (!WholeNumber(args!["amount"], out amount) || amount <= 0))
            {
                return Refused(Status.Invalid, "invalid_args");
            }
            if (amount > available)
            {
                return Refused(
                    Status.Refused,
                    "insufficient_liquid",
                    Pipeline.Reason(("requested", amount), ("available", available)));
            }
            return new Choice(item, new LiquidPlan(amount, available, material, amount * perHundred / 100), null);
        }

        if (!WholeNumber(item.Props.GetValueOrDefault("nutrition"), out var nutrition) || nutrition <= 0)
        {
            return Refused(Status.Refused, "not_consumable");
        }
        // A solid thing is eaten whole, or a portion at a time: an amount of it means nothing.
        if (args is not null && args.ContainsKey("amount"))
        {
            return Refused(Status.Invalid, "invalid_args");
        }
        if (!item.Props.TryGetValue("portions", out var portionsNode))
        {
            return new Choice(item, new SolidPlan(nutrition, null), null);
        }
        if (!WholeNumber(portionsNode, out var portions) || portions <= 0)
        {
            return Refused(Status.Refused, "not_consumable");
        }
        return new Choice(item, new SolidPlan(nutrition, portions), null);
    }

    // A creature whose mouth already holds something else cannot eat: the jaw is one grip, and the mouth rules of take
    // and give apply to it here too.
    private static bool MouthBusy(Pipeline.CommandContext context, string itemId)
    {
        var actorId = context.Command.Actor;
        var actor = context.Snapshot.Entities[actorId];
        var mouths = context.Registry.TryGetValue(actor.Template, out var template)
            ? template.Parts
                .Where(part => part.Contributes.GetValueOrDefault("mouth_carry") > 0 && part.Holds?.Kind == "grip")
                .Select(part => part.Name)
                .ToList()
            : new List<string>();
        return mouths.Count > 0
            && Carry.HeldInParts(context.Snapshot, actorId).Any(held => held.Id != itemId && mouths.Contains(held.InPart));
    }

    // A whole number in the safe integer range, as the engine reads a count: a JSON number with no fraction.
    private static bool WholeNumber(JsonNode? node, out long value)
    {
        if (node is JsonValue json && json.TryGetValue(out long number) && Math.Abs(number) <= MaxSafeInteger)
        {
            value = number;
            return true;
        }
        value = 0;
        return false;
    }

    private static Choice Refused(Status status, string reasonCode, IReadOnlyDictionary<string, JsonNode?>? reasonData = null) =>
        new(null, null, new Pipeline.Refusal(status, reasonCode, reasonData));
}
