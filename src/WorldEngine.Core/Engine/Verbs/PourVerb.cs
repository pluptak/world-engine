using WorldEngine.Core.Model;
using static WorldEngine.Core.Json.Integers;

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
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Suggest: Suggest,
        FreeArgs: true,
        Transition: Transition);

    // Each vessel, surface or room the actor can name, for the whole of what it holds in its hand: no `amount`, which pours
    // everything, so the offer never tells the figure (src/engine/verbs/pour.ts `suggest`).
    private static IReadOnlyList<Value.Map> Suggest(Pipeline.CommandContext context, IReadOnlyList<string> nameable)
    {
        var actor = context.Snapshot.Entities[context.Command.Actor];
        var source = context.Target is null ? null : context.Snapshot.Entities.GetValueOrDefault(context.Target.EntityId);
        if (source is null
            || source.ContainedIn != actor.Id
            || Carry.InSpacePart(context.Registry, actor, source)
            || source.Props.Get(Prop.LiquidMaterial) is not { Length: > 0 })
        {
            return [];
        }
        if (LiquidAmount(source) == 0)
        {
            return [];
        }
        return [.. nameable
            .Where(id => id != source.Id
                && context.Snapshot.Entities.TryGetValue(id, out var entity)
                && (entity.Props.Is(Prop.Container) || entity.Props.Is(Prop.Surface) || entity.Template == TemplateIds.Room))
            .Select(destination => Pipeline.Reason(("destination", destination)))];
    }

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
            return Refused(Pipeline.Invalid(Code.InvalidArgs));
        }
        if (target is null)
        {
            return Refused(Pipeline.Invalid(Code.MissingTarget));
        }
        if (target.Part is not null)
        {
            return Refused(Pipeline.Refused(Code.NotCarried));
        }
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var source))
        {
            return Refused(Pipeline.Invalid(Code.NoSuchEntity));
        }
        if (source.ContainedIn != actorId)
        {
            return Refused(Pipeline.Refused(Code.NotCarried));
        }
        // A vessel in a pocket is taken out before it is poured from.
        if (Carry.InSpacePart(context.Registry, actor, source))
        {
            return Refused(Pipeline.Refused(Code.NotInHand));
        }

        var material = source.Props.Get(Prop.LiquidMaterial);
        if (material is null || material.Length == 0)
        {
            return Refused(Pipeline.Refused(Code.NoLiquid));
        }
        var available = source.Props.Get(Prop.LiquidAmount);
        if (available is null || available < 0)
        {
            return Refused(Pipeline.Refused(Code.NoLiquid));
        }
        if (available == 0)
        {
            return Refused(Pipeline.Refused(Code.NothingToPour));
        }

        // An absent amount pours everything; a present one is a whole positive integer, so no pour rounds or quietly
        // becomes the whole contents.
        var requested = available.Value;
        var args = context.Command.Args;
        if (args is not null && args.ContainsKey("amount"))
        {
            if (args["amount"].AsInt() is not { } named || named <= 0)
            {
                return Refused(Pipeline.Invalid(Code.InvalidArgs));
            }
            requested = named;
        }
        if (requested > available)
        {
            return Refused(new Pipeline.Refusal(
                Status.Refused,
                Code.InsufficientLiquid,
                Pipeline.Reason(("requested", requested), ("available", available.Value))));
        }
        if (Pipeline.RequirementRefusal(context) is { } capacity)
        {
            return Refused(capacity);
        }

        var address = Address.AddressEntity(context, destinationText, Code.NotADestination);
        if (address.Failure is { } failure)
        {
            return Refused(failure);
        }
        var destination = address.Entity!;
        if (destination.Id == source.Id)
        {
            return Refused(Pipeline.Refused(Code.CannotPourIntoSelf));
        }
        // The floor has no position of its own, so reaching it is being in the room; anything else is measured from
        // where the actor stands.
        var reachable = destination.Template == TemplateIds.Room
            ? destination.Id == actor.Location
            : Reach.InReach(snapshot, actorId, destination.Id);
        if (!reachable)
        {
            var measure = Address.ReachData(snapshot, actorId, destination.Id);
            return Refused(new Pipeline.Refusal(
                Status.Refused,
                Code.OutOfReach,
                measure is null ? null : Pipeline.Reason(("distance_cm", measure.DistanceCm), ("reach_cm", measure.ReachCm))));
        }

        var holds = destination.Props.Is(Prop.Container);
        if (!holds && !destination.Props.Is(Prop.Surface) && destination.Template != TemplateIds.Room)
        {
            return Refused(Pipeline.Refused(Code.NotADestination));
        }

        // A container's own shutness hides its inside; anything else is hidden by whatever shut encloses it, and a
        // surface takes residue from above however shut the thing it stands on is.
        var enclosure = holds && destination.Props.Is(Prop.Openable) && !destination.Props.Is(Prop.Open)
            ? destination.Id
            : Reach.ClosedEnclosure(snapshot, destination.Id);
        if (enclosure is not null)
        {
            return Refused(Pipeline.Refused(Code.ContainerClosed, Pipeline.Reason(("enclosure", enclosure))));
        }

        long held = 0;
        if (holds)
        {
            var existing = destination.Props.Get(Prop.LiquidMaterial);
            if (existing is not null && existing.Length > 0)
            {
                if (existing != material)
                {
                    return Refused(new Pipeline.Refusal(
                        Status.Refused,
                        Code.IncompatibleLiquid,
                        Pipeline.Reason(("material", material), ("held_material", existing))));
                }
                held = LiquidAmount(destination);
            }
            if (LiquidCapacity(destination) is { } limit && held + requested > limit)
            {
                return Refused(new Pipeline.Refusal(
                    Status.Refused,
                    Code.ContainerFull,
                    Pipeline.Reason(("requested", requested), ("held", held), ("capacity", limit))));
            }
        }

        return (new Pouring(source, destination, material, requested, available.Value, held, holds), null);
    }

    private static (Pouring? Pour, Pipeline.Refusal? Refusal) Refused(Pipeline.Refusal refusal) => (null, refusal);


    // What a container holds of its liquid: its amount, when that is a positive whole number, else nothing.
    internal static long LiquidAmount(Entity entity) =>
        entity.Props.Get(Prop.LiquidAmount) is { } amount && amount > 0 ? amount : 0;

    // A vessel that declares `capacity_cm3` holds that much; otherwise a container's liquid capacity is its inner volume,
    // and a destination that declares neither is unbounded here.
    internal static long? LiquidCapacity(Entity destination)
    {
        if (destination.Props.Get(Prop.CapacityCm3) is { } declared && declared > 0)
        {
            return declared;
        }
        var width = destination.Props.Get(Prop.InnerWCm);
        var depth = destination.Props.Get(Prop.InnerDCm);
        var height = destination.Props.Get(Prop.InnerHCm);
        return width is null || depth is null || height is null
            ? null
            : width * depth * height;
    }

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context) => PlanOf(context).Refusal;

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var pour = PlanOf(context).Pour ?? throw new InvalidOperationException("Pour changed after validation");
        var poured = working.Emit(
            EventType.Poured,
            pour.Source.Id,
            Pipeline.Reason(("material", pour.Material), ("amount", pour.Amount), ("to", pour.Destination.Id)),
            rootEventId);

        var remaining = pour.Available - pour.Amount;
        var sourceProps = pour.Source.Props.With(Prop.LiquidAmount, remaining);
        // An emptied vessel declares no material at all, the way a broken one does.
        if (remaining == 0)
        {
            sourceProps = sourceProps.With(Prop.LiquidMaterial, "");
        }
        working.SetProps(pour.Source.Id, sourceProps, poured);

        if (pour.Holds)
        {
            working.SetProps(
                pour.Destination.Id,
                pour.Destination.Props.With(Prop.LiquidMaterial, pour.Material).With(Prop.LiquidAmount, pour.Held + pour.Amount),
                poured);
            return;
        }
        Residue.Add(working, pour.Destination.Id, new Dictionary<string, long> { [pour.Material] = pour.Amount }, poured);
    }
}
