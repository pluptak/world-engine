using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What a fall does to the thing that falls (src/resolvers/physical.ts `resolveDropFall`, `breakOnFall`, `breakEntity`,
// `spillVessel`): a fall past the thing's `break_fall_cm` breaks it into its template's break products, spreading its
// residue and clearing its liquid; a shorter fall spills a vessel's liquid onto where it lands. A break that would
// tumble the things it held onto a supported landing goes through the loss queue, which is not ported, so it throws
// before anything is written.
//
// `SpendEntity` (a thing used up: its `spent_products` where it stood, its `spent_residue` on the surface, then the
// thing removed) and `RemoveEntity` (a removal: what it was hiding is uncovered, what sat on or in it is released) are
// the removal path. A removal that would topple riders onto a landing needs the loss queue, which is not ported, so it
// throws before anything is written.
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

    // A thing used up (src/resolvers/physical.ts `spendEntity`): a `spent` event on it, each `spent_products` spawned
    // where it stood, its `spent_residue` added to the surface it stood on, and last the thing removed under `spent`.
    // A room is never used up. Returns whether it was removed.
    public static bool SpendEntity(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string causeId)
    {
        var entity = working.Snapshot.Entities[entityId];
        if (!registry.TryGetValue(entity.Template, out var template))
        {
            throw new InvalidOperationException($"Unknown template {entity.Template}");
        }
        if (entity.Template == "room")
        {
            return false;
        }

        var spentEvent = working.Emit("spent", entityId, new Dictionary<string, JsonNode?>(), causeId);
        var at = Placements.PlacementOf(working.Snapshot, entity);
        foreach (var product in template.SpentProducts ?? [])
        {
            for (var index = 0; index < product.Count; index++)
            {
                var lands = registry.TryGetValue(product.Template, out var productTemplate)
                    ? Placements.Fitting(working.Snapshot, at, productTemplate.SizeCm)
                    : at;
                working.SpawnUnder(
                    registry,
                    product.Template,
                    new Spawn.Overrides(lands.Location, lands.Support, lands.Pos, lands.ContainedIn),
                    spentEvent);
            }
        }

        var surface = at.Support ?? at.ContainedIn ?? at.Location;
        if (surface is not null && template.SpentResidue is { Count: > 0 } residue)
        {
            Residue.Add(working, surface, residue, spentEvent);
        }
        return RemoveEntity(working, registry, entityId, spentEvent);
    }

    // A removal (src/engine/verbs/edit.ts `removeEntity`): a `removed` event on the thing, what it was hiding uncovered,
    // what sat on or in it released to where it stood, then the thing gone. A room with someone in it is not removed.
    // Returns whether it was removed.
    public static bool RemoveEntity(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string targetId,
        string causeId)
    {
        if (!working.Snapshot.Entities.TryGetValue(targetId, out var doomed))
        {
            return false;
        }
        if (doomed.Template == "room"
            && working.Snapshot.Entities.Values.Any(entity => entity.Location == doomed.Id))
        {
            return false;
        }

        var removedEvent = working.Emit("removed", targetId, new Dictionary<string, JsonNode?>(), causeId);
        working.RecordEntityRemoval(targetId, doomed, removedEvent);
        // What the removed thing was hiding is uncovered rather than orphaned: it stays where it was.
        Concealment.RevealConcealed(working, targetId, removedEvent);
        PropagateSupportLoss(working, targetId);
        ReleaseDependents(working, registry, targetId, removedEvent, doomed);
        working.DropEntity(targetId);
        return true;
    }

    // What a removed support drops (src/resolvers/physical.ts `propagateSupportLoss`): the things it topples. A topple
    // is the loss queue, which is not ported, so a support with one on it throws; with none, nothing is queued.
    private static void PropagateSupportLoss(Working working, string supportId)
    {
        if (working.Snapshot.Entities.Values.Any(entity =>
                entity.Support == supportId && PropValues.IsTrue(entity.Props, "topples")))
        {
            throw new NotPortedException("removing a support that topples what is on it");
        }
    }

    // What sat in or on a removed thing takes its place (src/engine/verbs/edit.ts `releaseDependents`): contents go to
    // its holder, else to where it stood; riders on a surface that does not topple go to the surface's support. Every
    // moved thing's location is then re-derived with its subtree.
    private static void ReleaseDependents(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string targetId,
        string eventId,
        Entity former)
    {
        var carried = former.ContainedIn;
        var moved = new List<string>();
        foreach (var id in working.Snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            if (id == targetId)
            {
                continue;
            }
            var entity = working.Snapshot.Entities[id];
            var wasContent = entity.ContainedIn == targetId;
            var wasRider = entity.Support == targetId && !PropValues.IsTrue(entity.Props, "topples");
            if (!wasContent && !wasRider)
            {
                continue;
            }

            if (carried is not null)
            {
                working.SetRelation(id, "contained_in", carried, eventId);
                working.SetRelation(id, "in_part", KeepPart(entity, carried), eventId);
                working.SetRelation(id, "support", null, eventId);
                working.SetPos(id, null, eventId);
            }
            else if (wasContent)
            {
                working.SetRelation(id, "contained_in", null, eventId);
                working.SetRelation(id, "in_part", null, eventId);
                working.SetRelation(id, "support", former.Support, eventId);
                working.SetPos(id, former.Pos, eventId);
            }
            else
            {
                working.SetRelation(id, "support", former.Support, eventId);
                working.SetPos(id, former.Pos, eventId);
            }
            moved.Add(id);
        }
        foreach (var id in moved)
        {
            Placements.RefreshSubtreeLocations(working, id, eventId);
        }

        // A part name travels only onto a holder that declares it; what newly lands in a holder's grips takes the first
        // free one, the way a spawn does. Otherwise it is cleared.
        string? KeepPart(Entity entity, string holderId)
        {
            var holder = working.Snapshot.Entities.GetValueOrDefault(holderId);
            if (entity.InPart is not null)
            {
                var declared = registry.GetValueOrDefault(holder?.Template ?? string.Empty);
                return declared is not null && declared.Parts.Any(decl => decl.Name == entity.InPart && decl.Holds is not null)
                    ? entity.InPart
                    : null;
            }
            if (holder is null || Carry.HolderLayout(registry, holder.Template).Grips.Count == 0)
            {
                return null;
            }
            return Carry.ClaimGrip(working.Snapshot, registry, holderId, entity) is GripFound found ? found.Part : null;
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
