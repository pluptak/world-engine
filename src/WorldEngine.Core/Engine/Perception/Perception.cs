using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What an observer can sense now, and what an actor can name (src/engine/query.ts). This is the current-state half:
// the perceive query with no event. The event form, which reads what happened and who sensed it, is `EventPerception`.
public static class Perception
{
    public sealed record Answer(string Value, string BasisCode);

    private static readonly string[] ComputedSenses = ["sight", "hearing", "smell", "touch"];

    // Whether an observer senses an entity by a sense, now (`perceive` with no event). `value` is "true", "false" or
    // "unknown"; the basis says why.
    public static Answer Perceive(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string observerId, string entityId, string sense)
    {
        if (!snapshot.Entities.TryGetValue(observerId, out var observer))
        {
            return new Answer("false", "no_such_entity");
        }
        if (!ComputedSenses.Contains(sense))
        {
            return new Answer("unknown", "engine_incapable");
        }
        if (!snapshot.Coverage.Senses.Contains(sense))
        {
            return new Answer("unknown", "uncovered_sense");
        }
        // A destroyed body senses nothing, whatever its parts: the same end that stops it acting.
        if (observer.Status == EntityStatus.Destroyed)
        {
            return new Answer("false", "observer_destroyed");
        }
        // A body that runs on power senses nothing without it.
        if (PropValues.GetString(observer.Props, "powered_by") is not null && !Power.Powered(snapshot, observer.Id))
        {
            return new Answer("false", "unpowered");
        }
        // A sleeping body sees and hears nothing; touch and smell are unchanged.
        if (PropValues.IsTrue(observer.Props, "asleep") && sense is "sight" or "hearing")
        {
            return new Answer("false", "asleep");
        }
        // An unconscious body takes every sense.
        if (PropValues.IsTrue(observer.Props, "unconscious"))
        {
            return new Answer("false", "unconscious");
        }
        if ((Capacities.Of(snapshot, registry, observer.Id, sense) ?? 0) == 0)
        {
            return new Answer("false", "no_sense_capacity");
        }

        if (!snapshot.Entities.TryGetValue(entityId, out var subject))
        {
            return new Answer("false", "no_such_entity");
        }
        // An abstract entity exists and is not a thing to be sensed.
        if (Resolve.IsAbstract(registry, subject))
        {
            return new Answer("false", "abstract");
        }
        // Touch reads the body instead of the room.
        if (sense == "touch")
        {
            return TouchesBody(snapshot, registry, observer.Id, subject)
                ? new Answer("true", "own_body")
                : new Answer("false", "not_touching");
        }
        // What is hidden under or behind something is not seen, by anybody, until the relation is broken.
        if (sense == "sight" && subject.ConcealedBy is not null)
        {
            return new Answer("false", "concealed");
        }
        // A shut container hides what is inside it, however deep; hearing and smell do not care.
        if (sense == "sight" && Reach.ClosedEnclosure(snapshot, subject.Id) is not null)
        {
            return new Answer("false", "enclosed");
        }

        // The body's own answer from where it stands; then, for sight it does not have, each camera that feeds it.
        var body = BodyAnswer(snapshot, observer, subject, sense);
        // What the body cannot hear, an intercom may carry.
        if (sense == "hearing" && body.Value == "false" && body.BasisCode != "quiet" && HeardThroughIntercom(snapshot, observer, subject))
        {
            return new Answer("true", "intercom");
        }
        if (sense != "sight" || body.Value == "true")
        {
            return body;
        }
        foreach (var camera in Power.Feeds(snapshot, observer.Id, "camera"))
        {
            var cameraEntity = snapshot.Entities[camera];
            var at = cameraEntity.Location;
            var where = TargetLocationForPerception(subject, subject.Location, at);
            if (at is not null && at == where && IsLit(snapshot, at) && InCone(snapshot, cameraEntity, subject.Id))
            {
                return new Answer("true", "camera");
            }
        }
        return body;
    }

    // Whether the actor can name an entity: itself, the room it stands in, what it senses now by a covered sight,
    // smell or touch, or what it could grope for. A hidden thing stays unnamed, by id too.
    public static bool Addressable(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string actorId, string entityId)
    {
        if (!snapshot.Entities.TryGetValue(actorId, out var actor) || !snapshot.Entities.ContainsKey(entityId))
        {
            return false;
        }
        if (entityId == actorId || entityId == actor.Location)
        {
            return true;
        }
        var sensed = new[] { "sight", "smell", "touch" }.Any(sense =>
            snapshot.Coverage.Senses.Contains(sense)
            && Perceive(snapshot, registry, actorId, entityId, sense).Value == "true");
        return sensed || Gropable(snapshot, actorId, entityId);
    }

    // The half of `addressable` that needs no senses and no templates: what the actor could grope for.
    public static bool Gropable(Snapshot snapshot, string actorId, string entityId)
    {
        if (!snapshot.Entities.TryGetValue(actorId, out _) || !snapshot.Entities.TryGetValue(entityId, out var entity))
        {
            return false;
        }
        // What the actor controls it names from anywhere; so does a device a panel the actor reaches serves.
        if (Power.Controller(snapshot, entityId) == actorId || Power.PanelFor(snapshot, entityId, actorId) is not null)
        {
            return true;
        }
        if (entity.ConcealedBy is not null || Reach.ClosedEnclosure(snapshot, entityId) is not null)
        {
            return false;
        }
        return Reach.ReachedAsDoor(snapshot, actorId, entity) || Reach.InReach(snapshot, actorId, entityId);
    }

    // Whether a room is lit: it says so itself, something burning in it gives light, or a lamp on power does. A light
    // counts wherever it is in the room but not shut away in a closed container, and not once destroyed.
    public static bool IsLit(Snapshot snapshot, string roomId)
    {
        if (!snapshot.Entities.TryGetValue(roomId, out var room))
        {
            return false;
        }
        if (PropValues.IsTrue(room.Props, "lit"))
        {
            return true;
        }
        return snapshot.Entities.Values.Any(entity =>
            entity.Location == roomId
            && PropValues.IsTrue(entity.Props, "light_source")
            && entity.Status != EntityStatus.Destroyed
            && Reach.ClosedEnclosure(snapshot, entity.Id) is null
            && (PropValues.IsTrue(entity.Props, "burning")
                || (PropValues.GetString(entity.Props, "powered_by") is not null && Power.Powered(snapshot, entity.Id))));
    }

    // Whether an open door (or any door, when not `openOnly`) joins two rooms.
    private static bool ConnectedByDoor(Snapshot snapshot, string? from, string? to, bool openOnly) =>
        snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .Any(id =>
            {
                var entity = snapshot.Entities[id];
                if (!Resolve.IsDoor(entity))
                {
                    return false;
                }
                if (openOnly && !PropValues.IsTrue(entity.Props, "open"))
                {
                    return false;
                }
                return Reach.DoorJoins(entity.Props, from, to);
            });

    // A door or panel with no location is in either room it joins, so it is in the observer's room if the observer is in one of them.
    private static string? TargetLocationForPerception(Entity target, string? targetLocation, string? observerLocation)
    {
        if (targetLocation is not null)
        {
            return targetLocation;
        }
        var from = PropValues.GetString(target.Props, "from");
        var to = PropValues.GetString(target.Props, "to");
        if (from is not null && to is not null && observerLocation == from)
        {
            return from;
        }
        if (from is not null && to is not null && observerLocation == to)
        {
            return to;
        }
        return null;
    }

    private static Answer BodyAnswer(Snapshot snapshot, Entity observer, Entity subject, string sense)
    {
        var observerLocation = observer.Location;
        var targetLocation = TargetLocationForPerception(subject, subject.Location, observerLocation);
        if (observerLocation is null || targetLocation is null)
        {
            return new Answer("false", "not_perceptible");
        }
        var crossesDoors = sense is "hearing" or "smell";
        if (observerLocation == targetLocation)
        {
            if (crossesDoors)
            {
                // The entity row: hearing always reaches the listener in the same room; smell only where there is
                // something to smell.
                if (sense == "hearing" || (sense == "smell" && Smells(subject)))
                {
                    return new Answer("true", "same_location");
                }
                return new Answer("false", "odourless");
            }
            return IsLit(snapshot, observerLocation)
                ? new Answer("true", "same_location_lit")
                : new Answer("false", "location_unlit");
        }

        if (sense == "sight")
        {
            var connected = ConnectedByDoor(snapshot, observerLocation, targetLocation, true);
            var bothLit = IsLit(snapshot, observerLocation) && IsLit(snapshot, targetLocation);
            return connected && bothLit
                ? new Answer("true", "adjacent_open_door_lit")
                : new Answer("false", connected ? "location_unlit" : "not_perceptible");
        }
        // The entity row never carries sound or smell through a door.
        return new Answer("false", "not_perceptible");
    }

    // Whether the observer feels the subject through its body: the subject is the observer itself, or sits in one of
    // the observer's grips. Pockets don't feel.
    private static bool TouchesBody(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string observerId, Entity subject)
    {
        if (subject.Id == observerId)
        {
            return true;
        }
        if (subject.ContainedIn != observerId || subject.InPart is null)
        {
            return false;
        }
        var template = snapshot.Entities.TryGetValue(observerId, out var observer) && registry.TryGetValue(observer.Template, out var found)
            ? found
            : null;
        return template?.Parts.Any(part => part.Name == subject.InPart && part.Holds?.Kind == "grip") == true;
    }

    // What an entity offers the nose: a liquid it holds, or residue spilled on it.
    private static bool Smells(Entity subject)
    {
        var material = PropValues.GetString(subject.Props, "liquid_material");
        if (!string.IsNullOrEmpty(material))
        {
            return true;
        }
        return subject.Residue.Values.Any(amount => amount > 0);
    }

    // Whether an intercom in the observer's room carries the subject's sound. Only the entity row reads here, where
    // hearing reaches its listener in the same room, so a device in the subject's room is enough.
    private static bool HeardThroughIntercom(Snapshot snapshot, Entity observer, Entity subject)
    {
        foreach (var id in Power.Feeds(snapshot, observer.Id, "intercom"))
        {
            var device = snapshot.Entities[id];
            var where = TargetLocationForPerception(subject, subject.Location, device.Location);
            if (device.Location is not null && where == device.Location)
            {
                return true;
            }
        }
        return false;
    }

    // Whether a camera's cone takes in a subject: the angle between its facing and the line to the subject is at most
    // half the cone, the edge included. A camera with no cone sees its whole room.
    internal static bool InCone(Snapshot snapshot, Entity camera, string subjectId)
    {
        var cone = PropValues.GetNumber(camera.Props, "cone_deg");
        if (cone is null || cone >= Limits.FullCircleDegrees)
        {
            return true;
        }
        var facing = PropValues.GetNumber(camera.Props, "facing_deg");
        var from = Geometry.EffectivePos(snapshot, camera.Id);
        var to = Geometry.EffectivePos(snapshot, subjectId);
        if (facing is null || from is null)
        {
            return false;
        }
        if (to is null || (to.X == from.X && to.Y == from.Y))
        {
            return true;
        }
        double dx = to.X - from.X;
        double dy = to.Y - from.Y;
        var theta = facing.Value * Math.PI / 180;
        var along = Math.Cos(theta) * dx + Math.Sin(theta) * dy;
        return along >= double.Hypot(dx, dy) * Math.Cos(cone.Value * Math.PI / Limits.FullCircleDegrees) - 1e-9;
    }
}
