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
        DetachedFrom? DetachedFrom = null);

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

        // Every field at its default (`blankFields` in spawn.ts), then the template's own.
        var entity = new Entity(
            Id: id,
            Template: templateId,
            Name: overrides.Name ?? templateId,
            Aliases: [],
            Location: overrides.Location,
            Support: overrides.Support,
            ContainedIn: overrides.ContainedIn,
            InPart: null,
            ConcealedBy: null,
            Pos: overrides.Pos,
            DetachedFrom: overrides.DetachedFrom,
            Integrity: overrides.Integrity ?? template.MaxIntegrity ?? 100,
            Status: EntityStatus.Intact,
            Parts: new Dictionary<string, PartState>(),
            Residue: new Dictionary<string, long>(),
            Modifiers: [],
            Props: new Dictionary<string, JsonNode?>(template.Props, StringComparer.Ordinal),
            Traits: null);

        // spawn.ts gives an empty snapshot the default coverage; a snapshot a fall spawns into always has entities, so
        // its own coverage is kept as it is.
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal) { [id] = entity };
        return (snapshot with { NextSeq = snapshot.NextSeq + 1, Entities = entities }, id);
    }
}
