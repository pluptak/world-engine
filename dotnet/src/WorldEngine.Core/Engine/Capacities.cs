using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What a body can do, from its parts and its modifiers (src/engine/capacity.ts). A structural sum is what the
// body still has; a capacity adds the unexpired modifiers, and an unconscious body has none.
public static class Capacities
{
    // The part-contribution sum, before modifiers; null when the template declares no parts.
    public static long? Structural(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId, string name)
    {
        var (entity, template) = EntityAndTemplate(snapshot, registry, entityId);
        if (template.Parts.Count == 0)
        {
            return null;
        }

        var partsByName = template.Parts.ToDictionary(part => part.Name, StringComparer.Ordinal);
        PartState? StateOf(string partName) => PartStates.State(template, entity, partName);
        long total = 0;
        foreach (var part in template.Parts)
        {
            var state = StateOf(part.Name);
            if (state is null
                || state.Status is not (PartStatus.Intact or PartStatus.Damaged)
                || !part.Contributes.ContainsKey(name)
                || !AncestorsAvailable(part, partsByName, StateOf))
            {
                continue;
            }
            total += part.Contributes[name];
        }

        return Math.Clamp(total, 0, 100);
    }

    public static long? Of(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId, string name)
    {
        var structural = Structural(snapshot, registry, entityId, name);
        if (structural is null)
        {
            return null;
        }
        var (entity, _) = EntityAndTemplate(snapshot, registry, entityId);
        // An unconscious body has no capacity; the structural sums are unchanged, so what it holds stays held.
        if ((entity.Props.GetValueOrDefault("unconscious") as JsonValue)?.GetValueKind() is JsonValueKind.True)
        {
            return 0;
        }

        long total = structural.Value;
        foreach (var modifier in entity.Modifiers)
        {
            if (modifier.Capacity == name && (modifier.ExpiresAtTick is null || modifier.ExpiresAtTick > snapshot.Tick))
            {
                total += modifier.Delta;
            }
        }
        return Math.Clamp(total, 0, 100);
    }

    public static IReadOnlyDictionary<string, long>? All(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId) =>
        Record(Of, snapshot, registry, entityId);

    // The structural sums alone: a stunned carrier can hold on, a structurally broken one cannot.
    public static IReadOnlyDictionary<string, long>? StructuralAll(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId) =>
        Record(Structural, snapshot, registry, entityId);

    private static IReadOnlyDictionary<string, long>? Record(
        Func<Snapshot, IReadOnlyDictionary<string, Template>, string, string, long?> perCapacity,
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string entityId)
    {
        var (_, template) = EntityAndTemplate(snapshot, registry, entityId);
        if (template.Parts.Count == 0)
        {
            return null;
        }

        var names = template.Parts
            .SelectMany(part => part.Contributes.Keys)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(name => name, StringComparer.Ordinal);
        return names.ToDictionary(
            name => name,
            name => perCapacity(snapshot, registry, entityId, name) ?? 0,
            StringComparer.Ordinal);
    }

    private static (Entity Entity, Template Template) EntityAndTemplate(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string entityId)
    {
        if (!snapshot.Entities.TryGetValue(entityId, out var entity))
        {
            throw new InvalidOperationException($"Unknown entity {entityId}");
        }
        if (!registry.TryGetValue(entity.Template, out var template))
        {
            throw new InvalidOperationException($"Unknown template {entity.Template}");
        }
        return (entity, template);
    }

    private static bool AncestorsAvailable(
        PartDecl part,
        IReadOnlyDictionary<string, PartDecl> partsByName,
        Func<string, PartState?> stateOf)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var ancestorName = part.Parent;
        while (ancestorName is not null)
        {
            if (!visited.Add(ancestorName))
            {
                throw new InvalidOperationException($"Part cycle at {ancestorName}");
            }
            var state = stateOf(ancestorName);
            if (state is null || state.Status is PartStatus.Detached or PartStatus.Destroyed)
            {
                return false;
            }
            if (!partsByName.TryGetValue(ancestorName, out var ancestor))
            {
                throw new InvalidOperationException($"Unknown ancestor part {ancestorName}");
            }
            ancestorName = ancestor.Parent;
        }
        return true;
    }
}
