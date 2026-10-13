using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The pour verb (src/engine/verbs/pour.ts): an actor empties a vessel it holds into a container, onto a surface, or onto
// the floor of its room. The liquid's amount is cubic centimetres. A container takes the liquid itself, and a surface or
// the floor takes it as residue. Pouring takes hands.
public static class PourVerb
{
    public static Pipeline.VerbDecl Pour { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
        OneTick: true,
        Requires: [new Pipeline.Requirement("manipulation", 50)],
        Suggest: Suggest,
        FreeArgs: true,
        Transition: Transition);

    // Each vessel, surface or room the actor can name, for the whole of what it holds in its hand: no `amount`, which pours
    // everything, so the offer never tells the figure (src/engine/verbs/pour.ts `suggest`).
    private static IReadOnlyList<JsonObject> Suggest(Pipeline.CommandContext context, IReadOnlyList<string> nameable)
    {
        var actor = context.Snapshot.Entities[context.Command.Actor];
        var source = context.Target is null ? null : context.Snapshot.Entities.GetValueOrDefault(context.Target.EntityId);
        if (source is null
            || source.ContainedIn != actor.Id
            || Carry.InSpacePart(context.Registry, actor, source)
            || JsonReads.Text(source.Props.GetValueOrDefault("liquid_material")) is not { Length: > 0 })
        {
            return [];
        }
        if (LiquidAmount(source) == 0)
        {
            return [];
        }
        return nameable
            .Where(id => id != source.Id
                && context.Snapshot.Entities.TryGetValue(id, out var entity)
                && (PropValues.IsTrue(entity.Props, "container") || PropValues.IsTrue(entity.Props, "surface") || entity.Template == "room"))
            .Select(destination => new JsonObject { ["destination"] = destination })
            .ToList();
    }

    private const long MaxSafeInteger = 9007199254740991;

    private sealed record Pouring(
        Entity Source,
        Entity Destination,
        string Material,
        long Amount,
        long Available,
        long Held,
        bool Holds);

    // The vessel, destination and amount of a pour, or the refusal that stops it. Both the precondition and the transition
    // plan the pour, as the TypeScript verb does, so neither trusts a verdict carried between them.
    private static (Pouring? Pour, Pipeline.Refusal? Refusal) PlanOf(Pipeline.CommandContext context)
    {
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        var actor = snapshot.Entities[actorId];
        var destinationText = Address.AddressText(context, "destination");
        var target = context.Target;
        if (destinationText is null)
        {
            return Refused(Pipeline.Invalid("invalid_args"));
        }
        if (target is null)
        {
            return Refused(Pipeline.Invalid("missing_target"));
        }
        if (target.Part is not null)
        {
            return Refused(Pipeline.Refused("not_carried"));
        }
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var source))
        {
            return Refused(Pipeline.Invalid("no_such_entity"));
        }
        if (source.ContainedIn != actorId)
        {
            return Refused(Pipeline.Refused("not_carried"));
        }
        // A vessel in a pocket is taken out before it is poured from.
        if (Carry.InSpacePart(context.Registry, actor, source))
        {
            return Refused(Pipeline.Refused("not_in_hand"));
        }

        var material = PropValues.GetString(source.Props, "liquid_material");
        if (material is null || material.Length == 0)
        {
            return Refused(Pipeline.Refused("no_liquid"));
        }
        var available = WholeNumber(source.Props, "liquid_amount");
        if (available is null || available < 0)
        {
            return Refused(Pipeline.Refused("no_liquid"));
        }
        if (available == 0)
        {
            return Refused(Pipeline.Refused("nothing_to_pour"));
        }

        // An absent amount pours everything; a present one is a whole positive integer, so no pour rounds or quietly
        // becomes the whole contents.
        var requested = available.Value;
        var args = context.Command.Args;
        if (args is not null && args.ContainsKey("amount"))
        {
            if (args["amount"] is not JsonValue json || !json.TryGetValue(out long named) || named <= 0 || named > MaxSafeInteger)
            {
                return Refused(Pipeline.Invalid("invalid_args"));
            }
            requested = named;
        }
        if (requested > available)
        {
            return Refused(new Pipeline.Refusal(
                Status.Refused,
                "insufficient_liquid",
                Pipeline.Reason(("requested", requested), ("available", available.Value))));
        }
        if (Pipeline.RequirementRefusal(context) is { } capacity)
        {
            return Refused(capacity);
        }

        var address = Address.AddressEntity(context, destinationText, "not_a_destination");
        if (address.Failure is { } failure)
        {
            return Refused(failure);
        }
        var destination = address.Entity!;
        if (destination.Id == source.Id)
        {
            return Refused(Pipeline.Refused("cannot_pour_into_self"));
        }
        // The floor has no position of its own, so reaching it is being in the room; anything else is measured from
        // where the actor stands.
        var reachable = destination.Template == "room"
            ? destination.Id == actor.Location
            : Reach.InReach(snapshot, actorId, destination.Id);
        if (!reachable)
        {
            var measure = Address.ReachData(snapshot, actorId, destination.Id);
            return Refused(new Pipeline.Refusal(
                Status.Refused,
                "out_of_reach",
                measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm))));
        }

        var holds = PropValues.IsTrue(destination.Props, "container");
        if (!holds && !PropValues.IsTrue(destination.Props, "surface") && destination.Template != "room")
        {
            return Refused(Pipeline.Refused("not_a_destination"));
        }

        // A container's own shutness hides its inside; anything else is hidden by whatever shut encloses it, and a
        // surface takes residue from above however shut the thing it stands on is.
        var enclosure = holds && PropValues.IsTrue(destination.Props, "openable") && !PropValues.IsTrue(destination.Props, "open")
            ? destination.Id
            : Reach.ClosedEnclosure(snapshot, destination.Id);
        if (enclosure is not null)
        {
            return Refused(Pipeline.Refused("container_closed", Pipeline.Reason(("enclosure", enclosure))));
        }

        long held = 0;
        if (holds)
        {
            var existing = PropValues.GetString(destination.Props, "liquid_material");
            if (existing is not null && existing.Length > 0)
            {
                if (existing != material)
                {
                    return Refused(new Pipeline.Refusal(
                        Status.Refused,
                        "incompatible_liquid",
                        Pipeline.Reason(("material", material), ("held_material", existing))));
                }
                held = LiquidAmount(destination);
            }
            if (LiquidCapacity(destination) is { } limit && held + requested > limit)
            {
                return Refused(new Pipeline.Refusal(
                    Status.Refused,
                    "container_full",
                    Pipeline.Reason(("requested", requested), ("held", held), ("capacity", limit))));
            }
        }

        return (new Pouring(source, destination, material, requested, available.Value, held, holds), null);
    }

    private static (Pouring? Pour, Pipeline.Refusal? Refusal) Refused(Pipeline.Refusal refusal) => (null, refusal);

    // A numeric prop that is a whole number within the safe range, or null.
    private static long? WholeNumber(IReadOnlyDictionary<string, JsonNode?> props, string key)
    {
        var value = PropValues.GetNumber(props, key);
        return value is { } number && Math.Floor(number) == number && Math.Abs(number) <= MaxSafeInteger
            ? (long)number
            : null;
    }

    // What a container holds of its liquid: its amount, when that is a positive whole number, else nothing.
    internal static long LiquidAmount(Entity entity) =>
        WholeNumber(entity.Props, "liquid_amount") is { } amount && amount > 0 ? amount : 0;

    // A vessel that declares `capacity_cm3` holds that much; otherwise a container's liquid capacity is its inner volume,
    // and a destination that declares neither is unbounded here.
    internal static long? LiquidCapacity(Entity destination)
    {
        if (WholeNumber(destination.Props, "capacity_cm3") is { } declared && declared > 0)
        {
            return declared;
        }
        var width = PropValues.GetNumber(destination.Props, "inner_w_cm");
        var depth = PropValues.GetNumber(destination.Props, "inner_d_cm");
        var height = PropValues.GetNumber(destination.Props, "inner_h_cm");
        return width is null || depth is null || height is null
            ? null
            : (long)Math.Truncate(width.Value * depth.Value * height.Value);
    }

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context) => PlanOf(context).Refusal;

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var pour = PlanOf(context).Pour ?? throw new InvalidOperationException("Pour changed after validation");
        var poured = working.Emit(
            "poured",
            pour.Source.Id,
            Pipeline.Reason(("material", pour.Material), ("amount", pour.Amount), ("to", pour.Destination.Id)),
            rootEventId);

        var remaining = pour.Available - pour.Amount;
        var sourceProps = new Dictionary<string, JsonNode?>(pour.Source.Props, StringComparer.Ordinal)
        {
            ["liquid_amount"] = JsonValue.Create(remaining),
        };
        // An emptied vessel declares no material at all, the way a broken one does.
        if (remaining == 0)
        {
            sourceProps["liquid_material"] = JsonValue.Create("");
        }
        working.SetProps(pour.Source.Id, sourceProps, poured);

        if (pour.Holds)
        {
            var destinationProps = new Dictionary<string, JsonNode?>(pour.Destination.Props, StringComparer.Ordinal)
            {
                ["liquid_material"] = JsonValue.Create(pour.Material),
                ["liquid_amount"] = JsonValue.Create(pour.Held + pour.Amount),
            };
            working.SetProps(pour.Destination.Id, destinationProps, poured);
            return;
        }
        Residue.Add(working, pour.Destination.Id, new Dictionary<string, long> { [pour.Material] = pour.Amount }, poured);
    }
}
