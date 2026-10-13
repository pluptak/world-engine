using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Creating an entity (src/engine/spawn.ts `spawn`): a new id from `next_seq`, every field at its default, the template's
// props, then the overrides. A spawn into a holder takes its first free grip, and a holder spawned after
// what names it takes that thing into a grip.
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
        string? InPart = null,
        // An explicit null `in_part`: given as none, so the spawn takes no free grip.
        bool NoPart = false);

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

        // A spawn into a holder with grips and no part named takes the first free grip (spawn.ts `spawn`).
        if (entity.ContainedIn is { } holderId
            && overrides.InPart is null
            && !overrides.NoPart
            && snapshot.Entities.TryGetValue(holderId, out var holder)
            && Carry.HolderLayout(registry, holder.Template).Grips.Count > 0
            && Carry.ClaimGrip(snapshot, registry, holderId, entity) is GripFound found)
        {
            entity = entity with { InPart = found.Part };
        }
        // spawn.ts gives an empty snapshot the default coverage; a snapshot a fall spawns into always has entities, so
        // its own coverage is kept as it is.
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal) { [id] = entity };
        // A holder completes forward containment: whoever named it before it existed takes the first free grip now, in
        // entry order.
        if (Carry.HolderLayout(registry, templateId).Grips.Count > 0)
        {
            foreach (var otherId in entities.Keys.Order(StringComparer.Ordinal).ToList())
            {
                var other = entities[otherId];
                if (other.ContainedIn != id || other.InPart is not null)
                {
                    continue;
                }
                if (Carry.ClaimGrip(snapshot with { Entities = entities }, registry, id, other) is GripFound claimed)
                {
                    entities[otherId] = other with { InPart = claimed.Part };
                }
            }
        }
        return (snapshot with { NextSeq = snapshot.NextSeq + 1, Entities = entities }, id);
    }
}
