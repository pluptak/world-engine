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
        // A body tied up has no moving and no manipulation, whatever its parts (`docs/structure.md`).
        if (entity.Props.Is(Prop.Bound) && (name is "moving" or "manipulation"))
        {
            return 0;
        }

        var partsByName = template.Parts.ToDictionary(part => part.Name, StringComparer.Ordinal);
        PartState? StateOf(string partName) => PartStates.State(template, entity, partName);
        long total = 0;
        foreach (var part in template.Parts)
        {
            var state = StateOf(part.Name);
            var contributes = ContributesOf(registry, template, entity, part, partsByName);
            if (state is null
                || state.Bound is true
                || state.Status is not (PartStatus.Intact or PartStatus.Damaged)
                || !contributes.ContainsKey(name)
                || !AncestorsAvailable(part, partsByName, StateOf))
            {
                continue;
            }
            total += contributes[name];
        }

        return Math.Clamp(total, 0, 100);
    }

    // A part's contributions: from the installed template's part of the same name when the part or an ancestor
    // carries an install (`docs/sockets.md`), else from the body's own template. The installed root itself has no
    // same-name part in the installed template (a companion omits its root), so it reads the body's own.
    private static IReadOnlyDictionary<string, long> ContributesOf(
        IReadOnlyDictionary<string, Template> registry,
        Template template,
        Entity entity,
        PartDecl part,
        IReadOnlyDictionary<string, PartDecl> partsByName)
    {
        if (InstalledTemplateId(template, entity, part.Name, partsByName) is not { } installedId)
        {
            return part.Contributes;
        }
        if (!registry.TryGetValue(installedId, out var installed))
        {
            throw new InvalidOperationException($"Unknown installed template {installedId}");
        }
        return installed.Parts.FirstOrDefault(candidate => candidate.Name == part.Name)?.Contributes ?? part.Contributes;
    }

    // The install the part or its nearest ancestor carries, if any.
    private static string? InstalledTemplateId(
        Template template,
        Entity entity,
        string partName,
        IReadOnlyDictionary<string, PartDecl> partsByName)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = partName;
        while (current is not null)
        {
            if (!visited.Add(current))
            {
                throw new InvalidOperationException($"Part cycle at {current}");
            }
            if (PartStates.State(template, entity, current)?.Installed is { } installed)
            {
                return installed;
            }
            if (!partsByName.TryGetValue(current, out var decl))
            {
                throw new InvalidOperationException($"Unknown ancestor part {current}");
            }
            current = decl.Parent;
        }
        return null;
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
        if (entity.Props.Is(Prop.Unconscious))
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
            if (state is null || state.Bound is true || state.Status is PartStatus.Detached or PartStatus.Destroyed)
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
