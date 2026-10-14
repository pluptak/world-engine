using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Harm to an entity's own integrity (src/engine/harm.ts `hurt`): a `damaged` event, or a `destroyed` one that sets the
// status when nothing is left. A destroyed body holds nothing: what its grips and mouth held falls where it stands, each
// fall caused by the `destroyed`, and what is pocketed stays with it. Shared by a bleed and a process's `damage`.
public static class Harm
{
    // The event emitted and whether the entity was destroyed, or null when the entity is gone or already destroyed.
    public sealed record Hurt(string EventId, bool Destroyed);

    public static Hurt? Apply(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        long amount,
        string? causeId)
    {
        if (!working.Snapshot.Entities.TryGetValue(entityId, out var entity) || entity.Status == EntityStatus.Destroyed)
        {
            return null;
        }
        var integrity = Math.Max(0, entity.Integrity - amount);
        var eventId = working.Emit(
            integrity == 0 ? EventType.Destroyed : EventType.Damaged,
            entity.Id,
            Pipeline.Reason(("integrity", integrity)),
            causeId);
        working.SetIntegrity(entity.Id, integrity, eventId);
        if (integrity > 0)
        {
            return new Hurt(eventId, false);
        }

        working.SetStatus(entity.Id, EntityStatus.Destroyed, eventId);
        var body = working.Snapshot.Entities[entity.Id];
        var held = working.Snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .Where(id => working.Snapshot.Entities[id] is var item
                && item.ContainedIn == body.Id
                && !Carry.InSpacePart(registry, body, item))
            .ToList();
        foreach (var itemId in held)
        {
            DropVerb.DropCarriedItem(working, registry, body.Id, itemId, eventId);
        }
        // A body whose template names a successor leaves one where it lay, caused by its destruction: a body carried when it
        // dies leaves it at its carrier's feet (`PlaceInstead`). The body stays, destroyed, and the successor's `succeeds` is
        // the record of whose it is. The successor takes its template's own name, so the destroyed body and the one that took
        // over never share one.
        if (registry.TryGetValue(body.Template, out var template)
            && template.Props.Get(Prop.Successor) is { } successorTemplate)
        {
            var lands = Physical.PlaceInstead(working.Snapshot, registry, working.Snapshot.Entities[body.Id], successorTemplate);
            working.SpawnUnder(
                registry,
                successorTemplate,
                new Spawn.Overrides(
                    lands.Location,
                    lands.Support,
                    lands.Pos,
                    lands.ContainedIn,
                    Props: new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { [Prop.Succeeds] = JsonValue.Create(body.Id) }),
                eventId);
        }
        return new Hurt(eventId, true);
    }
}
