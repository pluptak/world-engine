using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Template upgrades against a world that is already in it (src/engine/upgrade.ts): the one thing a new template set may not take
// away from a live entity. Props and residue are not in it: a template seeds them at spawn, and the entity owns them afterwards.
// What is left is what would leave live state unreadable: a part in use that is no longer declared, or a product that can no
// longer be spawned.
public static class Upgrade
{
    // The first field a live entity's template no longer provides.
    public sealed record LostField(string Entity, string Template, string Field);

    // The first lost field, walking entities in id order, or null when the new set leaves every one of them whole.
    public static LostField? Lost(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry)
    {
        foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            var entity = snapshot.Entities[id];
            if (LostFor(snapshot, entity, registry) is { } field)
            {
                return new LostField(id, entity.Template, field);
            }
        }
        return null;
    }

    // The lost-field rule as the refusal it always gives.
    public static void AssertNoLost(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry)
    {
        if (Lost(snapshot, registry) is { } lost)
        {
            throw LostError(lost);
        }
    }

    public static WorldError LostError(LostField lost) =>
        new(Code.TemplatesLostField, $"Entity {lost.Entity} ({lost.Template}) uses {lost.Field}");

    // What an entity uses that the registry no longer gives, or null. A part is in use when it has stored state or something
    // sits in it; a product must still be spawnable.
    private static string? LostFor(Snapshot snapshot, Entity entity, IReadOnlyDictionary<string, Template> registry)
    {
        if (!registry.TryGetValue(entity.Template, out var template))
        {
            return "template";
        }
        var declared = template.Parts.Select(part => part.Name).ToHashSet(StringComparer.Ordinal);
        var used = entity.Parts.Keys.ToHashSet(StringComparer.Ordinal);
        foreach (var other in snapshot.Entities.Values)
        {
            if (other.ContainedIn == entity.Id && other.InPart is not null)
            {
                used.Add(other.InPart);
            }
        }
        foreach (var part in used.Order(StringComparer.Ordinal))
        {
            if (!declared.Contains(part))
            {
                return $"parts.{part}";
            }
        }
        foreach (var product in template.BreakProducts)
        {
            if (!registry.ContainsKey(product.Template))
            {
                return $"break_products.{product.Template}";
            }
        }
        foreach (var product in template.SpentProducts ?? [])
        {
            if (!registry.ContainsKey(product.Template))
            {
                return $"spent_products.{product.Template}";
            }
        }
        return null;
    }
}
