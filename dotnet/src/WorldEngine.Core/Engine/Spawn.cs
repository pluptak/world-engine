using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Creating an entity (src/engine/spawn.ts `spawn`): a new id from `next_seq`, every field at its default, the template's
// props, then the overrides. Only the placements a break, a fall or a used-up thing writes (location, support, position,
// and the container it lands in) are taken; spawning a holder, which claims grips, is not ported.
public static class Spawn
{
    public sealed record Overrides(
        string? Location = null,
        string? Support = null,
        Pos? Pos = null,
        string? ContainedIn = null,
        string? Name = null,
        long? Integrity = null,
        DetachedFrom? DetachedFrom = null,
        // The rest of an override (src/engine/spawn.ts `copyOverrides`): props merge onto the template's, the others replace
        // the blank field. Null is "not given", which is the blank field itself.
        IReadOnlyDictionary<string, JsonNode?>? Props = null,
        IReadOnlyList<string>? Aliases = null,
        IReadOnlyDictionary<string, string>? Traits = null,
        string? ConcealedBy = null,
        IReadOnlyDictionary<string, long>? Residue = null,
        EntityStatus? Status = null,
        IReadOnlyList<Modifier>? Modifiers = null,
        string? InPart = null);

    public static (Snapshot Snapshot, string Id) Create(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string templateId,
        Overrides overrides)
    {
        if (!registry.TryGetValue(templateId, out var template))
        {
            throw new InvalidOperationException($"Unknown template {templateId}");
        }
        var id = $"e{snapshot.NextSeq}";
        if (snapshot.Entities.ContainsKey(id))
        {
            throw new InvalidOperationException($"Entity id {id} already exists");
        }
        if (Carry.HolderLayout(registry, templateId).Grips.Count > 0)
        {
            throw new NotPortedException("spawning a holder, which claims its grips");
        }
        // A spawn into a holder with grips and no part named fills the first free grip, which is not ported.
        if (overrides.ContainedIn is { } holderId
            && overrides.InPart is null
            && snapshot.Entities.TryGetValue(holderId, out var holder)
            && Carry.HolderLayout(registry, holder.Template).Grips.Count > 0)
        {
            throw new NotPortedException("spawning into a holder's grip, which fills the first free one");
        }
        // An override's props merge onto the template's, so a spawn names only what it changes.
        var props = new Dictionary<string, JsonNode?>(template.Props, StringComparer.Ordinal);
        foreach (var (name, value) in overrides.Props ?? new Dictionary<string, JsonNode?>())
        {
            props[name] = value?.DeepClone();
        }

        // Every field at its default (`blankFields` in spawn.ts), then the template's own.
        var entity = new Entity(
            Id: id,
            Template: templateId,
            Name: overrides.Name ?? templateId,
            Aliases: overrides.Aliases ?? [],
            Location: overrides.Location,
            Support: overrides.Support,
            ContainedIn: overrides.ContainedIn,
            InPart: overrides.InPart,
            ConcealedBy: overrides.ConcealedBy,
            Pos: overrides.Pos,
            DetachedFrom: overrides.DetachedFrom,
            Integrity: overrides.Integrity ?? template.MaxIntegrity ?? 100,
            Status: overrides.Status ?? EntityStatus.Intact,
            Parts: new Dictionary<string, PartState>(),
            Residue: new Dictionary<string, long>(overrides.Residue ?? new Dictionary<string, long>(), StringComparer.Ordinal),
            Modifiers: overrides.Modifiers ?? [],
            Props: props,
            Traits: overrides.Traits is { Count: > 0 } traits ? new Dictionary<string, string>(traits, StringComparer.Ordinal) : null);

        // spawn.ts gives an empty snapshot the default coverage; a snapshot a fall spawns into always has entities, so
        // its own coverage is kept as it is.
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal) { [id] = entity };
        return (snapshot with { NextSeq = snapshot.NextSeq + 1, Entities = entities }, id);
    }
}
