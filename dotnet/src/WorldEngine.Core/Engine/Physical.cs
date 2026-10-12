using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What a fall does to the thing that falls (src/resolvers/physical.ts `resolveDropFall`, `breakOnFall`, `breakEntity`,
// `spillVessel`): a fall past the thing's `break_fall_cm` breaks it into its template's break products, spreading its
// residue and clearing its liquid; a shorter fall spills a vessel's liquid onto where it lands. A break that would
// tumble the things it held onto a supported landing goes through the loss queue, which is not ported, so it throws
// before anything is written.
public static class Physical
{
    // Where a fallen thing lands: the surface it rests on (null when none), the room it is in, and its position.
    public sealed record Landing(string? Support, string? Location, Pos? Pos);

    public static void ResolveDropFall(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string droppedEventId,
        double fallCm)
    {
        var entity = working.Snapshot.Entities[entityId];
        var landing = new Landing(entity.Support ?? entity.Location, entity.Location, entity.Pos);
        BreakOnFall(working, registry, entityId, droppedEventId, fallCm, landing);
    }

    private static void BreakOnFall(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string causeId,
        double fallCm,
        Landing landing)
    {
        var entity = working.Snapshot.Entities[entityId];
        var threshold = PropValues.GetNumber(entity.Props, "break_fall_cm");
        if (entity.Status is EntityStatus.Broken or EntityStatus.Destroyed || threshold is null || fallCm < threshold)
        {
            SpillVessel(working, entityId, causeId, fallCm, landing);
            return;
        }
        BreakEntity(working, registry, entityId, causeId, landing);
    }

    private static void BreakEntity(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string causeId,
        Landing landing)
    {
        var entity = working.Snapshot.Entities[entityId];
        if (!registry.TryGetValue(entity.Template, out var template))
        {
            throw new InvalidOperationException($"Unknown template {entity.Template}");
        }
        var contents = working.Snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .Where(id => working.Snapshot.Entities[id].ContainedIn == entityId)
            .ToList();
        if (contents.Count > 0 && landing.Support is not null)
        {
            throw new NotPortedException("a break that tumbles what the thing held");
        }

        var brokenEvent = working.Emit("broken", entityId, new Dictionary<string, JsonNode?>(), causeId);
        working.SetStatus(entityId, EntityStatus.Broken, brokenEvent);

        var landingSurface = landing.Support is null ? null : working.Snapshot.Entities.GetValueOrDefault(landing.Support);
        var location = landingSurface?.Template == "room" ? landingSurface.Id : landing.Location;
        foreach (var product in template.BreakProducts)
        {
            if (product.Count < 0)
            {
                throw new InvalidOperationException($"Invalid break product count for {entity.Template}");
            }
            for (var index = 0; index < product.Count; index++)
            {
                working.SpawnUnder(
                    registry,
                    product.Template,
                    new Spawn.Overrides(Location: location, Support: landing.Support, Pos: landing.Pos),
                    brokenEvent);
            }
        }

        // The residue a break leaves: the template's own, and the liquid the thing held, on the surface it lands on.
        var residueAdds = new Dictionary<string, long>(template.BreakResidue, StringComparer.Ordinal);
        var liquidMaterial = PropValues.GetString(entity.Props, "liquid_material");
        var liquidAmount = PropValues.GetNumber(entity.Props, "liquid_amount");
        if (!string.IsNullOrEmpty(liquidMaterial) && liquidAmount is { } amount)
        {
            residueAdds[liquidMaterial] = residueAdds.GetValueOrDefault(liquidMaterial) + (long)amount;
        }
        var residueSurface = landing.Support ?? location;
        if (residueSurface is not null && residueAdds.Count > 0)
        {
            Residue.Add(working, residueSurface, residueAdds, brokenEvent);
        }

        // The liquid is gone from the broken thing: its material and amount are cleared where they are written.
        if (PropValues.IsString(entity.Props, "liquid_material") || PropValues.IsNumber(entity.Props, "liquid_amount"))
        {
            var props = new Dictionary<string, JsonNode?>(entity.Props, StringComparer.Ordinal);
            if (PropValues.IsString(entity.Props, "liquid_material"))
            {
                props["liquid_material"] = JsonValue.Create("");
            }
            if (PropValues.IsNumber(entity.Props, "liquid_amount"))
            {
                props["liquid_amount"] = JsonValue.Create(0L);
            }
            working.SetProps(entityId, props, brokenEvent);
        }
    }

    // A vessel that falls without breaking spills all it holds onto its landing: one `spilled` event caused by the drop,
    // the liquid's residue on the surface, and the liquid cleared. A shut vessel keeps what it holds.
    private static void SpillVessel(
        Working working,
        string entityId,
        string droppedEventId,
        double fallCm,
        Landing landing)
    {
        if (fallCm <= 0)
        {
            return;
        }
        var entity = working.Snapshot.Entities[entityId];
        var material = PropValues.GetString(entity.Props, "liquid_material");
        var amount = PropValues.GetNumber(entity.Props, "liquid_amount");
        if (string.IsNullOrEmpty(material) || amount is null or <= 0)
        {
            return;
        }
        if (PropValues.IsTrue(entity.Props, "openable") && !PropValues.IsTrue(entity.Props, "open"))
        {
            return;
        }

        var surface = landing.Support ?? landing.Location;
        var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
        {
            ["material"] = JsonValue.Create(material),
            ["amount"] = JsonValue.Create(amount.Value),
            ["to"] = surface is null ? null : JsonValue.Create(surface),
        };
        var spilledEvent = working.Emit("spilled", entityId, data, droppedEventId);
        if (surface is not null)
        {
            Residue.Add(working, surface, new Dictionary<string, long> { [material] = (long)amount.Value }, spilledEvent);
        }
        var props = new Dictionary<string, JsonNode?>(entity.Props, StringComparer.Ordinal)
        {
            ["liquid_material"] = JsonValue.Create(""),
            ["liquid_amount"] = JsonValue.Create(0L),
        };
        working.SetProps(entityId, props, spilledEvent);
    }
}
