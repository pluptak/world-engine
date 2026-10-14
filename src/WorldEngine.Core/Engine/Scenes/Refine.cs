using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Refinement (src/engine/refine.ts): an entity becomes a more specific preset (a table a smaller table, a lantern a candle)
// without being respawned. What the new preset says about what a thing is, its definitions, replaces the old; the state the
// entity already has, where the new preset still has a field for it, stays.
public static class Refine
{
    // A preset is a refinement of another when it extends it, directly or through others.
    public static bool DescendsFrom(Template template, string ancestor) =>
        template.Lineage?.Contains(ancestor) == true;

    private static bool IsStateProp(Template template, string name) =>
        (Prop.Table.TryGetValue(name, out var field) && field.Tier == Tier.State)
        || (template.Fields is not null && template.Fields.TryGetValue(name, out var decl) && decl.Tier == "state");

    // The new preset's props, with the entity's state props the new preset declares laid over them. A state prop the new
    // preset does not declare is dropped with the field it belonged to.
    public static Dictionary<string, JsonNode?> RefinedProps(Entity subject, Template next)
    {
        var props = new Dictionary<string, JsonNode?>(next.Props, StringComparer.Ordinal);
        foreach (var (name, value) in subject.Props)
        {
            if (IsStateProp(next, name) && next.Props.ContainsKey(name))
            {
                props[name] = value?.DeepClone();
            }
        }
        return props;
    }

    // The stored part state under the new preset's defaults: a part that now sits at its default is not stored. Null when a
    // stored part is one the new preset has no part of.
    public static Dictionary<string, PartState>? RefinedParts(Entity subject, Template next)
    {
        if (subject.Parts.Keys.Any(name => !next.Parts.Any(part => part.Name == name)))
        {
            return null;
        }
        return PartStates.With(next, new Dictionary<string, PartState>(StringComparer.Ordinal), subject.Parts);
    }

    // The liquid a container holds at most: its declared capacity when that is a positive whole number, else its inner
    // volume, truncated. Null when neither is given.
    private static double? LiquidCapacity(IReadOnlyDictionary<string, JsonNode?> props)
    {
        var declared = props.Get(Prop.CapacityCm3);
        if (declared is { } capacity && IsWhole(capacity) && capacity > 0)
        {
            return capacity;
        }
        var width = props.Get(Prop.InnerWCm);
        var depth = props.Get(Prop.InnerDCm);
        var height = props.Get(Prop.InnerHCm);
        return width is { } w && depth is { } d && height is { } h ? w * d * h : null;
    }

    // Why an entity cannot become `next` here, or null for ok. Contents that no longer fit their holder or its parts are the
    // snapshot's own rules, held after the transition; what only a refinement can break is checked here: it is not a
    // refinement of what it is, a stored part is stronger than the new preset allows, it no longer fits the surface it stands
    // on or the things that stand on it, or it holds more liquid than it now can.
    public static Pipeline.Refusal? RefineRefusal(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        Entity subject,
        Template next)
    {
        if (!DescendsFrom(next, subject.Template))
        {
            return Pipeline.Refused(Code.NotARefinement);
        }
        if (RefinedParts(subject, next) is null)
        {
            return Pipeline.Refused(Code.UnknownPart);
        }
        // A part cannot be sounder than the new preset lets it be.
        foreach (var (name, state) in subject.Parts)
        {
            if (state.Integrity > next.Parts.First(part => part.Name == name).MaxIntegrity)
            {
                return Pipeline.Refused(Code.IntegrityOutOfRange);
            }
        }
        var props = RefinedProps(subject, next);
        var footprint = new double[] { next.SizeCm.W, next.SizeCm.D };

        var support = subject.Support is null ? null : snapshot.Entities.GetValueOrDefault(subject.Support);
        var supportTemplate = support is null ? null : registry.GetValueOrDefault(support.Template);
        if (supportTemplate is not null && support!.Props.Is(Prop.Surface))
        {
            var data = Fit.Misfit(footprint, [supportTemplate.SizeCm.W, supportTemplate.SizeCm.D]);
            if (data is { } misfit)
            {
                return TooLarge(misfit);
            }
        }

        // What stands on a surface has to keep a surface to stand on, and fit it.
        if (subject.Props.Is(Prop.Surface))
        {
            foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
            {
                var rider = snapshot.Entities[id];
                if (rider.Support != subject.Id)
                {
                    continue;
                }
                if (!props.Is(Prop.Surface))
                {
                    return Pipeline.Refused(Code.NotASurface);
                }
                if (registry.GetValueOrDefault(rider.Template) is { } riderTemplate
                    && Fit.Misfit(new double[] { riderTemplate.SizeCm.W, riderTemplate.SizeCm.D }, footprint) is { } data)
                {
                    return TooLarge(data);
                }
            }
        }

        var held = props.Get(Prop.LiquidAmount);
        var capacity = LiquidCapacity(props);
        if (held is { } amount && capacity is { } limit && amount > limit)
        {
            return new Pipeline.Refusal(
                Status.Refused,
                Code.LiquidExceedsCapacity,
                Pipeline.Reason(("held", amount), ("capacity", limit)));
        }
        return null;
    }

    private static Pipeline.Refusal TooLarge((double ItemCm, double SpaceCm) misfit) =>
        new(Status.Refused, Code.TooLarge, Pipeline.Reason(("item_cm", misfit.ItemCm), ("space_cm", misfit.SpaceCm)));
}
