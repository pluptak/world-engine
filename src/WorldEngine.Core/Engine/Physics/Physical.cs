using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What a fall does to the thing that falls (src/resolvers/physical.ts `resolveDropFall`, `breakOnFall`, `breakEntity`,
// `spillVessel`): a fall past the thing's `break_fall_cm` breaks it into its template's break products, spreading its
// residue and clearing its liquid; a shorter fall spills a vessel's liquid onto where it lands.
//
// `SpendEntity` (a thing used up: its `spent_products` where it stood, its `spent_residue` on the surface, then the
// thing removed) and `RemoveEntity` (a removal: what it was hiding is uncovered, what sat on or in it is released) are
// the removal path. A removal topples what sat on the thing, and a break tumbles what it held, both through the loss
// queue (`ProcessQueue`): each thing that loses its support is dropped to its landing, which may break it in turn.
public static class Physical
{
    // Where a fallen thing lands: the surface it rests on (null when none), the room it is in, and its position.
    public sealed record Landing(string? Support, string? Location, Pos? Pos);

    // One thing to take off its support in the loss queue. A request from a break carries the landing and the fall; one
    // from a removal (`Landing` null) finds its own landing from the support it stood on, and is `Displaced`, which
    // names the `displaced` event that caused the drop.
    public sealed record LossRequest(string Entity, string Cause, bool Displaced, Landing? Landing = null, double FallCm = 0);

    public static void ResolveDropFall(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string droppedEventId,
        double fallCm)
    {
        var entity = working.Snapshot.Entities[entityId];
        var landing = new Landing(entity.Support ?? entity.Location, entity.Location, entity.Pos);
        var queue = new Queue<LossRequest>();
        BreakOnFall(working, registry, entityId, droppedEventId, fallCm, landing, queue);
        ProcessQueue(working, registry, queue);
    }

    private static void BreakOnFall(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string causeId,
        double fallCm,
        Landing landing,
        Queue<LossRequest> queue)
    {
        var entity = working.Snapshot.Entities[entityId];
        var threshold = entity.Props.Get(Prop.BreakFallCm);
        if (entity.Status is EntityStatus.Broken or EntityStatus.Destroyed || threshold is null || fallCm < threshold)
        {
            SpillVessel(working, entityId, causeId, fallCm, landing);
            return;
        }
        BreakEntity(working, registry, entityId, causeId, fallCm, landing, queue);
    }

    private static void BreakEntity(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string causeId,
        double fallCm,
        Landing landing,
        Queue<LossRequest> queue)
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

        var brokenEvent = working.Emit("broken", entityId, new Dictionary<string, JsonNode?>(), causeId);
        working.SetStatus(entityId, EntityStatus.Broken, brokenEvent);

        var landingSurface = landing.Support is null ? null : working.Snapshot.Entities.GetValueOrDefault(landing.Support);
        var location = landingSurface?.Template == TemplateIds.Room ? landingSurface.Id : landing.Location;
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
        var liquidMaterial = entity.Props.Get(Prop.LiquidMaterial);
        var liquidAmount = entity.Props.Get(Prop.LiquidAmount);
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
        var hasMaterial = entity.Props.Get(Prop.LiquidMaterial) is not null;
        var hasAmount = entity.Props.Get(Prop.LiquidAmount) is not null;
        if (hasMaterial || hasAmount)
        {
            var props = entity.Props;
            if (hasMaterial)
            {
                props = props.With(Prop.LiquidMaterial, "");
            }
            if (hasAmount)
            {
                props = props.With(Prop.LiquidAmount, 0);
            }
            working.SetProps(entityId, props, brokenEvent);
        }

        // What it held tumbles out onto the landing, when there is one to land on.
        if (landing.Support is not null)
        {
            foreach (var contentId in contents)
            {
                queue.Enqueue(new LossRequest(contentId, brokenEvent, Displaced: false, landing, fallCm));
            }
        }
    }

    // Where a thing goes in place of the one that stood here: at its holder's feet, or beside a container it does not fit, as a
    // used-up thing's products go. A destroyed body's successor (`Harm.Apply`) is placed this way, so a body carried when it
    // dies leaves its successor on the floor rather than in a grip that holds one item.
    public static Placement PlaceInstead(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        Entity entity,
        string templateId)
    {
        var at = Placements.PlacementOf(snapshot, entity);
        return registry.TryGetValue(templateId, out var template) ? Placements.Fitting(snapshot, at, template.SizeCm) : at;
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
        if (entity.Template == TemplateIds.Room)
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
    // what sat on it toppled, what sat in or on it released to where it stood, then the thing gone. A room with someone
    // in it is not removed. Returns whether it was removed.
    public static bool RemoveEntity(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string targetId,
        string? causeId)
    {
        if (!working.Snapshot.Entities.TryGetValue(targetId, out var doomed))
        {
            return false;
        }
        if (doomed.Template == TemplateIds.Room
            && working.Snapshot.Entities.Values.Any(entity => entity.Location == doomed.Id))
        {
            return false;
        }

        var removedEvent = working.Emit("removed", targetId, new Dictionary<string, JsonNode?>(), causeId);
        working.RecordEntityRemoval(targetId, doomed, removedEvent);
        // What the removed thing was hiding is uncovered rather than orphaned: it stays where it was.
        Concealment.RevealConcealed(working, targetId, removedEvent);
        PropagateSupportLoss(working, registry, targetId, removedEvent);
        ReleaseDependents(working, registry, targetId, removedEvent, doomed);
        working.DropEntity(targetId);
        return true;
    }

    // A pushed thing that meets another strikes it with its mass times the distance it travelled (src/resolvers/physical.ts
    // `resolveImpact`). Either party breaks when that is at least what its own fall to breaking would take, its mass times
    // `break_fall_cm`; what declares no threshold takes no harm. The struck one is read first.
    public static void ResolveImpact(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string moverId,
        string obstacleId,
        long distanceCm,
        string collidedEventId)
    {
        var impact = MassOf(working.Snapshot, registry, moverId) * distanceCm;
        var queue = new Queue<LossRequest>();
        foreach (var id in new[] { obstacleId, moverId })
        {
            var entity = working.Snapshot.Entities[id];
            var threshold = entity.Props.Get(Prop.BreakFallCm);
            if (entity.Status is EntityStatus.Broken or EntityStatus.Destroyed
                || threshold is null
                || impact < MassOf(working.Snapshot, registry, id) * threshold)
            {
                continue;
            }
            var landing = new Landing(entity.Support, entity.Location, Geometry.EffectivePos(working.Snapshot, id));
            BreakEntity(working, registry, id, collidedEventId, 0, landing, queue);
        }
        ProcessQueue(working, registry, queue);
    }

    private static long MassOf(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId) =>
        registry.TryGetValue(snapshot.Entities[entityId].Template, out var template)
            ? template.MassG
            : throw new InvalidOperationException($"Unknown template {snapshot.Entities[entityId].Template}");

    // What a removed support drops (src/resolvers/physical.ts `propagateSupportLoss`): each thing on it that topples is
    // queued as displaced, in id order, and the queue is drained.
    public static void PropagateSupportLoss(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string supportId,
        string causeId)
    {
        var queue = new Queue<LossRequest>(
            working.Snapshot.Entities.Keys
                .Order(StringComparer.Ordinal)
                .Where(id => working.Snapshot.Entities[id].Support == supportId
                    && working.Snapshot.Entities[id].Props.Is(Prop.Topples))
                .Select(id => new LossRequest(id, causeId, Displaced: true)));
        ProcessQueue(working, registry, queue);
    }

    // Drains the loss queue in order (src/resolvers/physical.ts `processQueue`); a break inside it may queue more.
    private static void ProcessQueue(Working working, IReadOnlyDictionary<string, Template> registry, Queue<LossRequest> queue)
    {
        while (queue.Count > 0)
        {
            ProcessLoss(working, registry, queue.Dequeue(), queue);
        }
    }

    // One thing leaving its support (src/resolvers/physical.ts `processLoss`): its landing is the request's, or else it
    // is worked out from the support it stood on; a displaced thing's drop is caused by a `displaced` event; the drop
    // moves it, reveals what it was hiding, and breaks or spills it as any fall does.
    private static void ProcessLoss(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        LossRequest request,
        Queue<LossRequest> queue)
    {
        var entity = working.Snapshot.Entities[request.Entity];
        Landing landing;
        double fallCm;
        if (request.Landing is { } given)
        {
            landing = given;
            fallCm = request.FallCm;
        }
        else
        {
            if (entity.Support is null)
            {
                return;
            }
            (landing, fallCm) = LandingFromSupport(working, registry, entity.Id, entity.Support);
        }

        var dropCause = request.Cause;
        if (request.Displaced)
        {
            dropCause = working.Emit("displaced", entity.Id, new Dictionary<string, JsonNode?>(), request.Cause);
        }
        var dropped = working.Emit("dropped", entity.Id, Pipeline.Reason(("fall_cm", fallCm)), dropCause);

        if (working.Snapshot.Entities[entity.Id].ContainedIn is not null)
        {
            working.SetRelation(entity.Id, "contained_in", null, dropped);
        }
        working.SetRelation(entity.Id, "support", landing.Support, dropped);
        working.SetRelation(entity.Id, "location", landing.Location, dropped);
        working.SetPos(entity.Id, landing.Pos, dropped);
        // A thing that falls or is knocked out from under whatever hid it uncovers it, and stops being hidden itself if
        // it was under something else.
        Concealment.RevealConcealed(working, entity.Id, dropped);
        BreakOnFall(working, registry, entity.Id, dropped, fallCm, landing, queue);
    }

    // Where a thing that left its support lands and how far it falls (src/resolvers/physical.ts `landingFromSupport`):
    // the tallest surface under its old support's point that it can rest on, else the floor of its room.
    private static (Landing Landing, double FallCm) LandingFromSupport(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        string oldSupportId)
    {
        var snapshot = working.Snapshot;
        var entity = snapshot.Entities[entityId];
        var oldSupport = snapshot.Entities[oldSupportId];
        var oldElevation = Geometry.Elevation(snapshot, registry, entityId);
        var pos = Geometry.EffectivePos(snapshot, oldSupportId);
        string? supportId = oldSupport.Template == TemplateIds.Room ? oldSupport.Id : oldSupport.Support;
        string? lastSupport = null;

        // Climbs to the room, remembering the last thing on the way, which is where a fall from it lands if no room is named.
        while (supportId is not null)
        {
            var support = snapshot.Entities[supportId];
            if (support.Template == TemplateIds.Room)
            {
                break;
            }
            lastSupport = supportId;
            supportId = support.Support;
        }

        if (supportId is null)
        {
            var locationEntity = entity.Location is null ? null : snapshot.Entities.GetValueOrDefault(entity.Location);
            supportId = locationEntity?.Template == TemplateIds.Room ? entity.Location : lastSupport;
        }

        long newElevation = 0;
        Pos? landingPos = pos;
        var floor = supportId is null ? null : snapshot.Entities.GetValueOrDefault(supportId);
        var rest = floor?.Template == TemplateIds.Room && pos is not null
            ? DropVerb.RestingPlace(snapshot, registry, floor.Id, pos, oldElevation, entityId, [oldSupportId])
            : null;
        if (rest is not null)
        {
            supportId = rest.Support;
            newElevation = rest.HeightCm;
            landingPos = null;
        }
        else if (supportId is not null)
        {
            var support = snapshot.Entities[supportId];
            if (support.Template != TemplateIds.Room)
            {
                newElevation = Geometry.Elevation(snapshot, registry, supportId) + registry[support.Template].SizeCm.H;
            }
        }

        var landing = new Landing(supportId, LandingLocation(snapshot, supportId) ?? entity.Location, landingPos);
        return (landing, oldElevation - newElevation);
    }

    // The room a landing is in: a room is its own location, a thing is where it stands.
    private static string? LandingLocation(Snapshot snapshot, string? supportId)
    {
        if (supportId is null)
        {
            return null;
        }
        var support = snapshot.Entities[supportId];
        return support.Template == TemplateIds.Room ? support.Id : support.Location;
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
            var wasRider = entity.Support == targetId && !entity.Props.Is(Prop.Topples);
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
        var material = entity.Props.Get(Prop.LiquidMaterial);
        var amount = entity.Props.Get(Prop.LiquidAmount);
        if (string.IsNullOrEmpty(material) || amount is null or <= 0)
        {
            return;
        }
        if (entity.Props.Is(Prop.Openable) && !entity.Props.Is(Prop.Open))
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
        working.SetProps(entityId, entity.Props.With(Prop.LiquidMaterial, "").With(Prop.LiquidAmount, 0), spilledEvent);
    }
}
