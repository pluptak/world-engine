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
            integrity == 0 ? "destroyed" : "damaged",
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
        // A body whose template names a successor leaves one where it lay (`placeInstead`). No template in the repository
        // declares one, and its spawn is not ported, so it is refused loudly rather than left out.
        if (registry.TryGetValue(body.Template, out var template) && template.Props.ContainsKey("successor"))
        {
            throw new NotPortedException("successor spawns");
        }
        return new Hurt(eventId, true);
    }
}
