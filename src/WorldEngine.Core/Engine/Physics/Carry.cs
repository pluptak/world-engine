using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What it takes to hold a thing (src/engine/carry.ts): hands scale with the item's hands_required and together hold
// at most their limit; a mouth takes one thing at a time, never a two-handed one, and only up to the carrier's limit.
// The grip and hand bookkeeping, and the carry verdict. Placement of a take or give (`gripPlacement`) needs the verb
// context and is ported with the verbs.
public static class Carry
{
    public sealed record Alternative(
        string Capacity,
        long? PerHand = null,
        long? AtLeast = null,
        long? MaxHands = null,
        Prop<long>? MassLimitProp = null,
        long? Holds = null);

    public static readonly IReadOnlyList<Alternative> Alternatives =
    [
        new("manipulation", PerHand: 50, MassLimitProp: Prop.HandCarryLimitG),
        new("mouth_carry", AtLeast: 1, MaxHands: 1, MassLimitProp: Prop.CarryLimitG, Holds: 1),
    ];

    // The item a holder carries in one of its own parts. Grips hold one item each; a space holds what fits.
    public sealed record HeldItem(string Id, string InPart, long Hands);

    public sealed record Layout(IReadOnlyList<string> Grips, IReadOnlyList<(string Name, long[] Inner)> Spaces);

    // Why one alternative fails, ranked by how far it got through its conditions.
    private enum Kind { Capacity = 0, Hands = 1, Weight = 2, Full = 3 }

    private sealed record Failure(Kind Kind, string? Capacity = null, long Have = 0, long Need = 0);

    public static int HeldCount(Snapshot snapshot, string carrierId) =>
        snapshot.Entities.Values.Count(entity => entity.ContainedIn == carrierId);

    private static long HandsOf(Entity item) =>
        item.Props.Get(Prop.HandsRequired) == 2 ? 2 : 1;

    // The holder parts a template declares, in declaration order.
    // Whether an item fits a pocket (src/engine/carry.ts `spaceRefusal`): null when it does. An unknown part or item, or
    // one with no size, is refused without data, as TypeScript's is.
    public static Pipeline.Refusal? SpaceRefusal(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string holderId,
        string part,
        Entity item)
    {
        var holder = snapshot.Entities.GetValueOrDefault(holderId);
        if (holder is null || !registry.TryGetValue(holder.Template, out var template))
        {
            return Pipeline.Refused("unknown_part");
        }
        var space = HolderLayout(registry, template.Id).Spaces.FirstOrDefault(candidate => candidate.Name == part);
        if (space.Name is null)
        {
            return Pipeline.Refused("unknown_part");
        }
        if (!registry.TryGetValue(item.Template, out var itemTemplate))
        {
            return Pipeline.Refused("too_large");
        }
        var size = itemTemplate.SizeCm;
        var fit = Fit.Misfit([size.W, size.D, size.H], [.. space.Inner.Select(value => (double)value)]);
        return fit is null
            ? null
            : Pipeline.Refused("too_large", Pipeline.Reason(("item_cm", fit.Value.ItemCm), ("space_cm", fit.Value.SpaceCm)));
    }

    public static Layout HolderLayout(IReadOnlyDictionary<string, Template> registry, string templateId)
    {
        var grips = new List<string>();
        var spaces = new List<(string, long[])>();
        if (registry.TryGetValue(templateId, out var template))
        {
            foreach (var part in template.Parts)
            {
                if (part.Holds is null)
                {
                    continue;
                }
                if (part.Holds.Kind == HoldKind.Grip)
                {
                    grips.Add(part.Name);
                }
                else
                {
                    spaces.Add((part.Name, [part.Holds.InnerWCm!.Value, part.Holds.InnerDCm!.Value, part.Holds.InnerHCm!.Value]));
                }
            }
        }
        return new Layout(grips, spaces);
    }

    // A part holds only while it and every ancestor above it are intact or damaged.
    public static bool PartAvailable(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string holderId, string partName)
    {
        if (!snapshot.Entities.TryGetValue(holderId, out var holder) || !registry.TryGetValue(holder.Template, out var template))
        {
            return false;
        }
        var parents = template.Parts.ToDictionary(part => part.Name, part => part.Parent, StringComparer.Ordinal);
        string? current = partName;
        while (current is not null)
        {
            var state = PartStates.State(template, holder, current);
            if (state is null || (state.Status != PartStatus.Intact && state.Status != PartStatus.Damaged))
            {
                return false;
            }
            current = parents.GetValueOrDefault(current);
        }
        return true;
    }

    // Everything the holder carries that names one of its parts, in id order.
    public static IReadOnlyList<HeldItem> HeldInParts(Snapshot snapshot, string holderId) =>
        [.. snapshot.Entities.Keys.Order(StringComparer.Ordinal)
            .Select(id => snapshot.Entities[id])
            .Where(entity => entity.ContainedIn == holderId && entity.InPart is not null)
            .Select(entity => new HeldItem(entity.Id, entity.InPart!, HandsOf(entity)))];

    // A two-handed item's other grip: the first grip that is not its primary, in template order.
    public static string? GripSecondary(IReadOnlyList<string> grips, string primary) =>
        grips.FirstOrDefault(grip => grip != primary);

    // The grips each item occupies, or the full set when the packing is impossible (null).
    public static HashSet<string>? PackGrips(IReadOnlyList<string> grips, IReadOnlyList<HeldItem> items)
    {
        var used = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var item in items)
        {
            if (!grips.Contains(item.InPart))
            {
                return null;
            }
            used[item.InPart] = used.GetValueOrDefault(item.InPart) + 1;
            if (item.Hands > 1)
            {
                var second = GripSecondary(grips, item.InPart);
                if (second is null)
                {
                    return null;
                }
                used[second] = used.GetValueOrDefault(second) + 1;
            }
        }
        if (used.Values.Any(count => count > 1))
        {
            return null;
        }
        return used.Keys.ToHashSet(StringComparer.Ordinal);
    }

    // Where a new item lands in the holder's grips, or the refusal it earns. The item itself is left out of the
    // packing (`exclude`): it vacates its grip on the way in.
    public static GripClaim ClaimGrip(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string holderId,
        Entity item,
        string? named = null,
        string? exclude = null)
    {
        if (!snapshot.Entities.TryGetValue(holderId, out var holder) || !registry.ContainsKey(holder.Template))
        {
            return new GripRefused("unknown_part", null);
        }
        var grips = HolderLayout(registry, holder.Template).Grips
            .Where(grip => PartAvailable(snapshot, registry, holderId, grip))
            .ToList();
        var packed = PackGrips(
            grips,
            [.. HeldInParts(snapshot, holderId).Where(held => held.Id != exclude && grips.Contains(held.InPart))]);
        // An unpackable holder is refused, never written through: every grip reads full.
        var full = packed ?? grips.ToHashSet(StringComparer.Ordinal);
        var hands = HandsOf(item);
        var freeCount = grips.Count(grip => !full.Contains(grip));
        if (named is not null)
        {
            if (!grips.Contains(named))
            {
                return new GripRefused("unknown_part", null);
            }
            var second = hands > 1 ? GripSecondary(grips, named) : named;
            if (full.Contains(named) || second is null || full.Contains(second))
            {
                return new GripRefused("hands_full", Data(("free", 0), ("need", hands)));
            }
            return new GripFound(named);
        }
        if (hands > 1)
        {
            var primary = grips.FirstOrDefault(grip =>
            {
                var second = GripSecondary(grips, grip);
                return !full.Contains(grip) && second is not null && !full.Contains(second);
            });
            if (primary is null)
            {
                return new GripRefused("hands_full", Data(("free", freeCount), ("need", hands)));
            }
            return new GripFound(primary);
        }
        var free = grips.FirstOrDefault(grip => !full.Contains(grip));
        if (free is null)
        {
            return new GripRefused("hands_full", Data(("free", 0), ("need", hands)));
        }
        return new GripFound(free);
    }

    // Who falls when the holder loses parts: items naming unavailable parts, and two-handed items whose secondary went
    // with them. Items naming no declared holder part are the validator's business and stay out of it.
    public static IReadOnlyList<string> GripEvictions(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string holderId)
    {
        if (!snapshot.Entities.TryGetValue(holderId, out var holder) || !registry.ContainsKey(holder.Template))
        {
            return [];
        }
        var layout = HolderLayout(registry, holder.Template);
        var declared = layout.Grips.Concat(layout.Spaces.Select(space => space.Name)).ToHashSet(StringComparer.Ordinal);
        var available = declared
            .Where(name => PartAvailable(snapshot, registry, holderId, name))
            .ToHashSet(StringComparer.Ordinal);
        var evicted = new List<string>();
        foreach (var item in HeldInParts(snapshot, holderId))
        {
            if (!declared.Contains(item.InPart))
            {
                continue;
            }
            if (!available.Contains(item.InPart))
            {
                evicted.Add(item.Id);
                continue;
            }
            if (item.Hands > 1 && layout.Grips.Contains(item.InPart))
            {
                var second = GripSecondary(layout.Grips, item.InPart);
                if (second is null || !available.Contains(second))
                {
                    evicted.Add(item.Id);
                }
            }
        }
        return evicted;
    }

    // The mass the holder's grips already hold, the item itself left out. Spaces (pockets) are not hands.
    public static long HandsHeldMass(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string holderId, string? exclude)
    {
        if (!snapshot.Entities.TryGetValue(holderId, out var holder))
        {
            return 0;
        }
        var grips = HolderLayout(registry, holder.Template).Grips.ToHashSet(StringComparer.Ordinal);
        long mass = 0;
        foreach (var held in HeldInParts(snapshot, holderId))
        {
            if (held.Id == exclude || !grips.Contains(held.InPart))
            {
                continue;
            }
            mass += registry.TryGetValue(snapshot.Entities[held.Id].Template, out var template) ? template.MassG : 0;
        }
        return mass;
    }

    private static Failure? AlternativeFailure(
        IReadOnlyDictionary<string, long>? caps,
        IReadOnlyDictionary<string, JsonNode?> carrierProps,
        Entity item,
        IReadOnlyDictionary<string, Template> registry,
        long otherHeld,
        Alternative alternative,
        long? handsMassG = null)
    {
        if (caps is null)
        {
            return new Failure(
                Kind.Capacity,
                alternative.Capacity,
                0,
                alternative.PerHand is { } perHand ? HandsOf(item) * perHand : alternative.AtLeast ?? 1);
        }
        var hands = HandsOf(item);
        if (alternative.PerHand is { } rate)
        {
            var have = caps.GetValueOrDefault(alternative.Capacity);
            if (have < hands * rate)
            {
                return new Failure(Kind.Capacity, alternative.Capacity, have, hands * rate);
            }
            // Hands hold at most their limit at once. Absent the prop there is no limit.
            if (alternative.MassLimitProp is { } limitProp && handsMassG is { } held)
            {
                if (carrierProps.Get(limitProp) is { } limit)
                {
                    var each = registry.TryGetValue(item.Template, out var itemTemplate) ? itemTemplate.MassG : 0;
                    if (each + held > limit)
                    {
                        return new Failure(Kind.Weight, alternative.Capacity);
                    }
                }
            }
            return null;
        }
        var atLeast = alternative.AtLeast ?? 1;
        if (caps.GetValueOrDefault(alternative.Capacity) < atLeast)
        {
            return new Failure(Kind.Capacity, alternative.Capacity, caps.GetValueOrDefault(alternative.Capacity), atLeast);
        }
        if (alternative.MaxHands is { } maxHands && hands > maxHands)
        {
            return new Failure(Kind.Hands);
        }
        if (alternative.MassLimitProp is { } prop)
        {
            var limit = carrierProps.Get(prop);
            if (limit is null || !registry.TryGetValue(item.Template, out var template) || template.MassG > limit)
            {
                return new Failure(Kind.Weight, alternative.Capacity);
            }
        }
        if (alternative.Holds is { } holds && otherHeld >= holds)
        {
            return new Failure(Kind.Full, alternative.Capacity);
        }
        return null;
    }

    // Whether any declared alternative can hold the item. A refusal names the failure that got furthest, ties going to
    // the first declared alternative; a capacity shortfall also reports what it had and what it needed.
    public static CarryVerdict Check(
        IReadOnlyDictionary<string, long>? caps,
        IReadOnlyDictionary<string, JsonNode?> carrierProps,
        Entity item,
        IReadOnlyDictionary<string, Template> registry,
        long otherHeld,
        IReadOnlyList<Alternative> alternatives,
        long? handsMassG = null)
    {
        (string Code, int Rank, IReadOnlyDictionary<string, JsonNode?>? Data)? worst = null;
        foreach (var alternative in alternatives)
        {
            var failure = AlternativeFailure(caps, carrierProps, item, registry, otherHeld, alternative, handsMassG);
            if (failure is null)
            {
                return new CarryVerdict(true, null, null);
            }
            var rank = (int)failure.Kind;
            if (worst is null || rank > worst.Value.Rank)
            {
                worst = (FailureCode(failure), rank, failure.Kind == Kind.Capacity ? Data(
                    ("capacity", failure.Capacity!), ("have", failure.Have), ("need", failure.Need)) : null);
            }
        }
        return worst is null
            ? new CarryVerdict(false, "uncarryable", null)
            : new CarryVerdict(false, worst.Value.Code, worst.Value.Data);
    }

    // The capacity that held the item before a change and cannot after it, or null.
    public static string? LostCarry(
        IReadOnlyDictionary<string, long>? before,
        IReadOnlyDictionary<string, long>? after,
        IReadOnlyDictionary<string, JsonNode?> carrierProps,
        Entity item,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<Alternative> alternatives)
    {
        foreach (var alternative in alternatives)
        {
            var wasMet = AlternativeFailure(before, carrierProps, item, registry, 0, alternative) is null;
            var isMet = AlternativeFailure(after, carrierProps, item, registry, 0, alternative) is null;
            if (wasMet && !isMet)
            {
                return alternative.Capacity;
            }
        }
        return null;
    }

    private static string FailureCode(Failure failure) => failure.Kind switch
    {
        Kind.Capacity => $"insufficient_{failure.Capacity}",
        Kind.Hands => "two_hands_required",
        Kind.Weight => "too_heavy",
        _ => "mouth_full",
    };

    // Whether the item is in a space part (a pocket, not a grip) of the holder.
    public static bool InSpacePart(IReadOnlyDictionary<string, Template> registry, Entity holder, Entity item) =>
        item.InPart is not null && HolderLayout(registry, holder.Template).Spaces.Any(space => space.Name == item.InPart);

    // The grip a take or give lands in. A `part` argument that is not a non-empty string is invalid; otherwise the
    // claim decides, and a refusal is `hands_full` (with its data) or `unknown_part`.
    public static GripPlacement PlaceInGrip(Pipeline.CommandContext context, string holderId, Entity item)
    {
        string? named = null;
        if (context.Command.Args is { } args && args.TryGetValue("part", out var raw))
        {
            if (raw is null || raw.GetValueKind() != JsonValueKind.String || raw.GetValue<string>().Length == 0)
            {
                return new GripInvalid("invalid_args");
            }
            named = raw.GetValue<string>();
        }
        return ClaimGrip(context.Snapshot, context.Registry, holderId, item, named, item.Id) switch
        {
            GripFound found => new GripPlaced(found.Part),
            GripRefused { ReasonCode: "hands_full" } full => new GripBlocked("hands_full", full.ReasonData),
            _ => new GripBlocked("unknown_part", null),
        };
    }

    private static IReadOnlyDictionary<string, JsonNode?> Data(params (string Key, object Value)[] pairs) =>
        Pipeline.Reason(pairs);
}

// The verdict of `Carry.Check`: `Ok`, or the refusal code and its data.
public sealed record CarryVerdict(bool Ok, string? ReasonCode, IReadOnlyDictionary<string, JsonNode?>? ReasonData);

// The result of `Carry.ClaimGrip`: the grip the item lands in, or the refusal.
public abstract record GripClaim;
public sealed record GripFound(string Part) : GripClaim;
public sealed record GripRefused(string ReasonCode, IReadOnlyDictionary<string, JsonNode?>? ReasonData) : GripClaim;

// The grip a take or give lands in (src/engine/carry.ts `gripPlacement`): the `part` argument, or the lowest free grip,
// once the capacity checks have run. The item itself is left out of the packing, so taking it from its own grip is
// the same grip again.
public abstract record GripPlacement;
public sealed record GripPlaced(string Part) : GripPlacement;
public sealed record GripBlocked(string ReasonCode, IReadOnlyDictionary<string, JsonNode?>? ReasonData) : GripPlacement;
public sealed record GripInvalid(string ReasonCode) : GripPlacement;
