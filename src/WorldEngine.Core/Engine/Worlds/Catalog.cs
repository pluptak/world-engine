using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// What the architect may pick and say about it (src/engine/catalog.ts): each preset's shown definition and the forms a scenario
// entry may use on it, with their defaults. Tuning (reach, damage, process timing, hit parts) is not shown. A function of the
// template set alone, so a caller can read it before any world exists.
public static class Catalog
{
    public sealed record CatalogLiquid(string? Material, long Pct);

    public sealed record CatalogForms(
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? FuelPct,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] CatalogLiquid? Liquid,
        string Condition,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? HungerPct,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? PortionsPct,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Approximate);

    public sealed record CatalogEntry(
        string Template,
        Dimensions SizeCm,
        long MassG,
        bool Container,
        bool Surface,
        bool Openable,
        bool Barrier,
        bool LightSource,
        bool Agent,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? CapacityCm3,
        IReadOnlyList<string> Parts,
        IReadOnlyDictionary<string, long> Capacities,
        IReadOnlyList<string> BreaksInto,
        CatalogForms Forms);

    // Every pickable preset by template id: all but the companions of detachable parts and the bases a template set marks
    // `"catalog": false`.
    public static IReadOnlyList<CatalogEntry> Of(IReadOnlyDictionary<string, Template> registry)
    {
        var hidden = Companions(registry);
        return [.. registry.Keys.Order(StringComparer.Ordinal)
            .Where(id => !hidden.Contains(id) && registry[id].Catalog != false)
            .Select(id => EntryOf(registry[id]))];
    }

    // A detachable part's own template is `<template>.<part>`: it exists to be spawned when the part comes off, and the
    // architect never picks it.
    private static HashSet<string> Companions(IReadOnlyDictionary<string, Template> registry)
    {
        var found = new HashSet<string>(StringComparer.Ordinal);
        foreach (var template in registry.Values)
        {
            foreach (var part in template.Parts)
            {
                var id = $"{template.Id}.{part.Name}";
                if (part.Detachable && registry.ContainsKey(id))
                {
                    found.Add(id);
                }
            }
        }
        return found;
    }


    private static CatalogForms FormsOf(Template template)
    {
        long? fuelPct = template.Props.Get(Prop.Fuel) is not null ? 100 : null;
        CatalogLiquid? liquid = null;
        var approximate = new List<string>();
        if (template.Props.Get(Prop.CapacityCm3) is { } capacity)
        {
            var amount = template.Props.Get(Prop.LiquidAmount) ?? 0;
            var material = template.Props.Get(Prop.LiquidMaterial) is { Length: > 0 } text ? text : null;
            var pct = Math.Min(100, (long)Math.Floor((double)amount * 100 / capacity));
            liquid = new CatalogLiquid(material, pct);
            // Judged by what placing the listed pct stores, so the floor and the never-0 rule count.
            if (Forms.Share(capacity, pct) != amount)
            {
                approximate.Add("liquid");
            }
        }
        long? hungerPct = null;
        if (template.Props.Get(Prop.Hunger) is { } hunger)
        {
            hungerPct = Math.Min(hunger, 100);
            if (hunger > 100)
            {
                approximate.Add("hunger_pct");
            }
        }
        long? portionsPct = template.Props.Get(Prop.Portions) is not null ? 100 : null;
        return new CatalogForms(
            fuelPct,
            liquid,
            "intact",
            hungerPct,
            portionsPct,
            approximate.Count > 0 ? approximate : null);
    }

    private static CatalogEntry EntryOf(Template template)
    {
        var capacities = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var part in template.Parts)
        {
            foreach (var (capacity, amount) in part.Contributes)
            {
                capacities[capacity] = capacities.GetValueOrDefault(capacity) + amount;
            }
        }
        return new CatalogEntry(
            template.Id,
            template.SizeCm,
            template.MassG,
            template.Props.Is(Prop.Container),
            template.Props.Is(Prop.Surface),
            template.Props.Is(Prop.Openable),
            template.Props.Is(Prop.Barrier),
            template.Props.Is(Prop.LightSource),
            template.Props.Is(Prop.Agent),
            template.Props.Get(Prop.CapacityCm3),
            [.. template.Parts.Select(part => part.Name)],
            capacities,
            [.. template.BreakProducts.Where(product => product.Count > 0).Select(product => product.Template).Distinct(StringComparer.Ordinal)],
            FormsOf(template));
    }
}
