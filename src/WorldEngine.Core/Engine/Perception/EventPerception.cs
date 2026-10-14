using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Event-form perception (src/engine/query.ts `perceive` with an event, `eventPerceivers`, `sensedBy`): who could sense what
// happened, by sense, from where they stood. Each event type has a row of the sense table, read by the observer's sense
// in the same room, across a doorway, or through a body, an intercom or a camera. The entity form is `Perception`.
public static class EventPerception
{
    // Speech is heard within this distance of a whisperer (src/engine/query.ts `NEAR_THRESHOLD_CM`).



    private enum SameRule
    {
        Always,
        Odorous,
        Never,
        Volume,
    }

    private enum DoorRule
    {
        Loud,
        Never,
    }

    // One sense in one situation: `Same` decides the observer's own room, `Door` decides across a doorway, and `Basis` is
    // what a false answer says when nothing about where the observer stands is wrong.
    private sealed record SenseRule(SameRule Same, DoorRule Door, string Basis);

    // The row of the sense table for an event type. Touch reads the body, not the room, and is either felt or not.
    private sealed record EventSenses(SenseRule Hearing, SenseRule Smell, bool TouchesBody);

    private static readonly EventSenses Audible = new(
        new SenseRule(SameRule.Always, DoorRule.Loud, "odourless"),
        new SenseRule(SameRule.Never, DoorRule.Never, "odourless"),
        TouchesBody: true);

    // The world author's own work: nobody senses it, and `Basis` says why.
    private static readonly EventSenses Authored = new(
        new SenseRule(SameRule.Never, DoorRule.Never, "authored"),
        new SenseRule(SameRule.Never, DoorRule.Never, "authored"),
        TouchesBody: false);

    private static readonly EventSenses Sounded = new(
        Audible.Hearing,
        new SenseRule(SameRule.Never, DoorRule.Never, "odourless"),
        TouchesBody: false);

    private static readonly EventSenses Say = new(
        new SenseRule(SameRule.Volume, DoorRule.Loud, "too_far"),
        new SenseRule(SameRule.Never, DoorRule.Never, "odourless"),
        TouchesBody: true);

    private static readonly EventSenses Pour = new(
        Audible.Hearing,
        new SenseRule(SameRule.Always, DoorRule.Never, "odourless"),
        TouchesBody: true);

    private static readonly EventSenses Silent = new(
        new SenseRule(SameRule.Never, DoorRule.Never, "quiet"),
        Audible.Smell,
        TouchesBody: true);

    private static readonly EventSenses Broken = new(
        Audible.Hearing,
        new SenseRule(SameRule.Odorous, DoorRule.Loud, "odourless"),
        TouchesBody: true);

    // The rows of the sense table, keyed by every event type the engine emits (src/engine/query.ts `EVENT_SENSES`). A type
    // not listed is read like an audible event.
    private static readonly Dictionary<string, EventSenses> Table = new(StringComparer.Ordinal)
    {
        ["move"] = Audible,
        ["take"] = Silent,
        ["drop"] = Audible,
        ["put"] = Silent,
        ["give"] = Silent,
        ["open"] = Audible,
        ["close"] = Audible,
        ["lock"] = Audible,
        ["unlock"] = Audible,
        ["switch_on"] = Audible,
        ["switch_off"] = Audible,
        ["push"] = Audible,
        ["pull"] = Audible,
        ["attack"] = Audible,
        ["wait"] = Silent,
        ["advance"] = Authored,
        ["changed"] = Silent,
        ["search"] = Silent,
        ["consume"] = Silent,
        ["consumed"] = Silent,
        ["spent"] = Silent,
        ["light"] = Silent,
        ["douse"] = Silent,
        ["lit"] = Silent,
        ["doused"] = Silent,
        ["moved"] = Audible,
        ["collided"] = Audible,
        ["dropped"] = Audible,
        ["displaced"] = Audible,
        ["damaged"] = Audible,
        ["destroyed"] = Audible,
        ["detached"] = Audible,
        ["capability_changed"] = Silent,
        ["opened"] = Audible,
        ["closed"] = Audible,
        ["closing"] = Audible,
        ["switched"] = Audible,
        ["jammed"] = Audible,
        ["locked"] = Audible,
        ["unlocked"] = Audible,
        ["spawned"] = Audible,
        ["revealed"] = Silent,
        ["found"] = Silent,
        ["pour"] = Pour,
        ["poured"] = Pour,
        ["spilled"] = Pour,
        ["broken"] = Broken,
        ["edit"] = Authored,
        ["placed"] = Authored,
        ["edited"] = Authored,
        ["removed"] = Authored,
        ["sounded"] = Sounded,
        ["say"] = Say,
        ["beat_skipped"] = Authored,
    };

    // Whether the world authored this event: decided from its own type and one step up its cause chain, never from an actor.
    private static bool IsAuthored(WorldEvent eventRecord, IReadOnlyList<WorldEvent> events)
    {
        if (Table.TryGetValue(eventRecord.Type, out var own) && own == Authored)
        {
            return true;
        }
        if (eventRecord.Type != "spawned" || eventRecord.CauseId is null)
        {
            return false;
        }
        var cause = events.FirstOrDefault(candidate => candidate.EventId == eventRecord.CauseId);
        return cause is not null && Table.TryGetValue(cause.Type, out var causeRow) && causeRow == Authored;
    }

    // The sense row an event is read by: the authored row when the world wrote it, else its type's row.
    private static EventSenses SensesFor(WorldEvent eventRecord, IReadOnlyList<WorldEvent> events) =>
        IsAuthored(eventRecord, events)
            ? Authored
            : Table.GetValueOrDefault(eventRecord.Type, Audible);

    // Whether a `moved` was caused by a hand act: the cause chain is walked to its root, and a take, give or put at the
    // bottom silences it. A chain that names nothing is read as footsteps.
    private static bool HandCaused(WorldEvent eventRecord, IReadOnlyList<WorldEvent> events)
    {
        var current = eventRecord;
        while (true)
        {
            if (current.CauseId is null)
            {
                return current.Type is "take" or "give" or "put";
            }
            var parent = events.FirstOrDefault(candidate => candidate.EventId == current.CauseId);
            if (parent is null)
            {
                return false;
            }
            current = parent;
        }
    }

    // A thing that happened that is heard in the room and, when loud, next door.
    private static bool LoudEvent(WorldEvent? eventRecord)
    {
        if (eventRecord is null)
        {
            return false;
        }
        var data = eventRecord.Data;
        return eventRecord.Type is "broken" or "detached"
            || (eventRecord.Type == "sounded" && JsonReads.IsTrue(data.GetValueOrDefault("loud")))
            || (eventRecord.Type == "say" && JsonReads.Text(data.GetValueOrDefault("volume")) == "shout")
            || (eventRecord.Type == "dropped" && JsonReads.Number(data.GetValueOrDefault("fall_cm")) is { } fall && fall >= 50);
    }

    // The room an event happened in: the room its data names, else the subject's own.
    private static string? EventLocation(WorldEvent eventRecord, Entity fallback) =>
        JsonReads.Text(eventRecord.Data.GetValueOrDefault("location")) ?? fallback.Location;

    // A door with no location is in either room it connects; treat it as in the observer's room if they're in one of them.
    private static string? TargetLocationForPerception(Entity target, string? targetLocation, string? observerLocation)
    {
        if (targetLocation is not null)
        {
            return targetLocation;
        }
        var from = target.Props.Get(Prop.From);
        var to = target.Props.Get(Prop.To);
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

    // Whether a subject holds a liquid or has residue spilled on it: what there is to smell.
    private static bool Smells(Entity subject)
    {
        var material = subject.Props.Get(Prop.LiquidMaterial);
        return material is { Length: > 0 } || subject.Residue.Values.Any(amount => amount > 0);
    }

    private static bool WithinThreshold(Pos here, Pos there)
    {
        var dx = here.X - there.X;
        var dy = here.Y - there.Y;
        return dx * dx + dy * dy <= Queries.NearThresholdCm * Queries.NearThresholdCm;
    }

    // Whether speech at its volume reaches a listener (an agent, or an intercom standing for one): a whisper only within
    // the threshold of the speaker, anything louder the whole room. A speaker hears their own.
    private static bool HeardAtVolume(Snapshot snapshot, string listenerId, Entity speaker, WorldEvent? eventRecord)
    {
        if (JsonReads.Text((eventRecord?.Data ?? new Dictionary<string, JsonNode?>()).GetValueOrDefault("volume")) != "whisper"
            || listenerId == speaker.Id)
        {
            return true;
        }
        var here = Geometry.EffectivePos(snapshot, listenerId);
        var there = Geometry.EffectivePos(snapshot, speaker.Id);
        return here is not null && there is not null && WithinThreshold(here, there);
    }

    // Whether the observer feels the subject through its body: the subject is the observer itself, or sits in one of its grips.
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
        var template = registry.GetValueOrDefault(snapshot.Entities[observerId].Template);
        return template is not null && template.Parts.Any(part => part.Name == subject.InPart && part.Holds?.Kind == HoldKind.Grip);
    }

    // What intercoms carry to an observer, hearing only: a sound in the room of an intercom that feeds the observer, and a
    // `say` by the agent an intercom it controls, heard in that intercom's room. Nothing crosses a door.
    private static bool HeardThroughIntercom(Snapshot snapshot, Entity observer, Entity subject, WorldEvent? eventRecord, SenseRule sense)
    {
        foreach (var id in Power.Feeds(snapshot, observer.Id, Prop.Intercom))
        {
            var device = snapshot.Entities[id];
            var where = TargetLocationForPerception(
                subject,
                eventRecord is null ? subject.Location : EventLocation(eventRecord, subject),
                device.Location);
            if (device.Location is not null
                && where == device.Location
                && (sense.Same == SameRule.Always
                    || (sense.Same == SameRule.Volume && HeardAtVolume(snapshot, device.Id, subject, eventRecord))))
            {
                return true;
            }
        }
        if (eventRecord?.Type == "say")
        {
            foreach (var id in Power.Feeds(snapshot, subject.Id, Prop.Intercom))
            {
                var device = snapshot.Entities[id];
                if (device.Location is not null
                    && device.Location == observer.Location
                    && HeardAtVolume(snapshot, observer.Id, device, eventRecord))
                {
                    return true;
                }
            }
        }
        return false;
    }

    private static bool ConnectedByDoor(Snapshot snapshot, string from, string to, bool openOnly) =>
        snapshot.Entities.Values
            .OrderBy(entity => entity.Id, StringComparer.Ordinal)
            .Any(entity => Resolve.IsDoor(entity)
                && (!openOnly || entity.Props.Is(Prop.Open))
                && Reach.DoorJoins(entity.Props, from, to));

    // Whether an observer senses an event by a sense (`perceive` with an event). `Value` is "true", "false" or "unknown";
    // the basis says why.
    public static Perception.Answer Perceive(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events,
        string observerId,
        string eventId,
        string sense)
    {
        if (!snapshot.Entities.TryGetValue(observerId, out var observer))
        {
            return new Perception.Answer(Truth.False, "no_such_entity");
        }
        if (!Sense.All.Contains(sense))
        {
            return new Perception.Answer(Truth.Unknown, "engine_incapable");
        }
        if (!snapshot.Coverage.Senses.Contains(sense))
        {
            return new Perception.Answer(Truth.Unknown, "uncovered_sense");
        }
        // A destroyed body senses nothing, whatever its parts.
        if (observer.Status == EntityStatus.Destroyed)
        {
            return new Perception.Answer(Truth.False, "observer_destroyed");
        }
        // A body that runs on power senses nothing without it.
        if (observer.Props.Get(Prop.PoweredBy) is not null && !Power.Powered(snapshot, observer.Id))
        {
            return new Perception.Answer(Truth.False, "unpowered");
        }
        // A sleeping body sees and hears nothing; touch and smell are unchanged.
        if (observer.Props.Is(Prop.Asleep) && sense is Sense.Sight or Sense.Hearing)
        {
            return new Perception.Answer(Truth.False, "asleep");
        }
        // An unconscious body takes every sense.
        if (observer.Props.Is(Prop.Unconscious))
        {
            return new Perception.Answer(Truth.False, "unconscious");
        }
        if ((Capacities.Of(snapshot, registry, observer.Id, sense) ?? 0) == 0)
        {
            return new Perception.Answer(Truth.False, "no_sense_capacity");
        }

        var eventRecord = events.FirstOrDefault(candidate => candidate.EventId == eventId);
        if (eventRecord is null)
        {
            return new Perception.Answer(Truth.False, "no_such_event");
        }

        // What the world writes is not something that happened in front of anybody: no sense reports it.
        var authored = IsAuthored(eventRecord, events);
        if (!snapshot.Entities.TryGetValue(eventRecord.Entity, out var named))
        {
            // A `removed` event names an entity no longer there to be sensed; what made it is that the world wrote it.
            return authored ? new Perception.Answer(Truth.False, "authored") : new Perception.Answer(Truth.False, "no_such_entity");
        }
        // A `found` event is where the search happened, not what was under it: it is read against the concealer.
        var subject = eventRecord.Type == "found" && JsonReads.Text(eventRecord.Data.GetValueOrDefault("concealer")) is { } concealer
            && snapshot.Entities.TryGetValue(concealer, out var concealerEntity)
                ? concealerEntity
                : named;
        // An abstract entity exists and is not a thing to be sensed.
        if (Resolve.IsAbstract(registry, subject))
        {
            return new Perception.Answer(Truth.False, "abstract");
        }
        if (authored)
        {
            return new Perception.Answer(Truth.False, "authored");
        }
        var rule = SensesFor(eventRecord, events);
        // Touch reads the body instead of the room: the table says which classes can be felt at all, and the body rule says
        // whether this observer felt this one.
        if (sense == Sense.Touch)
        {
            if (!rule.TouchesBody)
            {
                return new Perception.Answer(Truth.False, "authored");
            }
            // A collision is felt by what was hit as much as by what moved.
            var struck = eventRecord.Type == "collided" && JsonReads.Text(eventRecord.Data.GetValueOrDefault("with")) is { } with
                ? snapshot.Entities.GetValueOrDefault(with)
                : null;
            return TouchesBody(snapshot, registry, observer.Id, subject)
                || (struck is not null && TouchesBody(snapshot, registry, observer.Id, struck))
                ? new Perception.Answer(Truth.True, "own_body")
                : new Perception.Answer(Truth.False, "not_touching");
        }
        // A sound is heard, never seen, wherever the observer stands.
        if (sense == Sense.Sight && eventRecord.Type == "sounded")
        {
            return new Perception.Answer(Truth.False, "unseen");
        }
        // What is hidden under or behind something is not seen, by anybody, until the relation is broken.
        if (sense == Sense.Sight && subject.ConcealedBy is not null)
        {
            return new Perception.Answer(Truth.False, "concealed");
        }
        // A shut container hides what is inside it, however deep; hearing and smell do not care.
        if (sense == Sense.Sight && Reach.ClosedEnclosure(snapshot, subject.Id) is not null)
        {
            return new Perception.Answer(Truth.False, "enclosed");
        }

        // The body's own answer from where it stands; then, for sight it does not have, each camera that feeds it.
        var body = BodyAnswer(snapshot, events, observer, subject, eventRecord, sense, rule);
        // What the body cannot hear, an intercom may carry; a `quiet` hand act is not carried.
        if (sense == Sense.Hearing
            && body.Value == Truth.False
            && body.BasisCode != "quiet"
            && HeardThroughIntercom(snapshot, observer, subject, eventRecord, rule.Hearing))
        {
            return new Perception.Answer(Truth.True, "intercom");
        }
        if (sense != Sense.Sight || body.Value == Truth.True)
        {
            return body;
        }
        foreach (var camera in Power.Feeds(snapshot, observer.Id, Prop.Camera))
        {
            var cameraEntity = snapshot.Entities[camera];
            var at = cameraEntity.Location;
            var where = TargetLocationForPerception(subject, EventLocation(eventRecord, subject), at);
            if (at is not null && at == where && Perception.IsLit(snapshot, at) && Perception.InCone(snapshot, cameraEntity, subject.Id))
            {
                return new Perception.Answer(Truth.True, "camera");
            }
        }
        return body;
    }

    // The observer's own answer from where it stands: the room it is in, or the doorway it is across from.
    private static Perception.Answer BodyAnswer(
        Snapshot snapshot,
        IReadOnlyList<WorldEvent> events,
        Entity observer,
        Entity subject,
        WorldEvent eventRecord,
        string sense,
        EventSenses rule)
    {
        var observerLocation = observer.Location;
        var targetLocation = TargetLocationForPerception(subject, EventLocation(eventRecord, subject), observerLocation);
        if (observerLocation is null || targetLocation is null)
        {
            return new Perception.Answer(Truth.False, "not_perceptible");
        }
        var crossesDoors = sense is Sense.Hearing or Sense.Smell;
        // A `moved` the hands caused is as silent as the act behind it: footsteps stay audible, and the door never carries
        // what the room itself does not hear.
        if (sense == Sense.Hearing && eventRecord.Type == "moved" && HandCaused(eventRecord, events))
        {
            return new Perception.Answer(Truth.False, "quiet");
        }
        var senseRow = sense == Sense.Hearing ? rule.Hearing : rule.Smell;
        if (observerLocation == targetLocation)
        {
            if (crossesDoors)
            {
                if (senseRow.Same == SameRule.Always
                    || (senseRow.Same == SameRule.Odorous && Smells(subject))
                    || (senseRow.Same == SameRule.Volume && HeardAtVolume(snapshot, observer.Id, subject, eventRecord)))
                {
                    return new Perception.Answer(Truth.True, "same_location");
                }
                return new Perception.Answer(Truth.False, senseRow.Basis);
            }
            // Sight: the room is lit or it is not.
            return Perception.IsLit(snapshot, observerLocation)
                ? new Perception.Answer(Truth.True, "same_location_lit")
                : new Perception.Answer(Truth.False, "location_unlit");
        }

        if (sense == Sense.Sight)
        {
            var connected = ConnectedByDoor(snapshot, observerLocation, targetLocation, openOnly: true);
            var bothLit = Perception.IsLit(snapshot, observerLocation) && Perception.IsLit(snapshot, targetLocation);
            return connected && bothLit
                ? new Perception.Answer(Truth.True, "adjacent_open_door_lit")
                : new Perception.Answer(Truth.False, connected ? "location_unlit" : "not_perceptible");
        }
        // Across a doorway, a sound is heard only when it is loud.
        return ConnectedByDoor(snapshot, observerLocation, targetLocation, openOnly: false)
            && senseRow.Door == DoorRule.Loud
            && LoudEvent(eventRecord)
            ? new Perception.Answer(Truth.True, "adjacent_loud_event")
            : new Perception.Answer(Truth.False, "not_perceptible");
    }

    // Each event of a command, with who could sense it by each covered sense, from either end of the command
    // (src/engine/query.ts `eventPerceivers`). An agent is listed when it senses the event before or after.
    public static List<(string EventId, Perceivers Perceivers)> EventPerceivers(
        Snapshot before,
        Snapshot after,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events)
    {
        var unknown = Sense.All.Where(sense => !after.Coverage.Senses.Contains(sense)).ToList();
        var agents = before.Entities.Keys.Concat(after.Entities.Keys)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .Where(id => Reach.IsAgent(after.Entities.ContainsKey(id) ? after : before, id))
            .ToList();
        var rows = new List<(string, Perceivers)>();
        foreach (var eventRecord in events)
        {
            var seen = Sense.All.ToDictionary(sense => sense, _ => new List<string>(), StringComparer.Ordinal);
            foreach (var observer in agents)
            {
                foreach (var sense in Sense.All)
                {
                    if (unknown.Contains(sense))
                    {
                        continue;
                    }
                    if (Perceive(before, registry, events, observer, eventRecord.EventId, sense).Value == Truth.True
                        || Perceive(after, registry, events, observer, eventRecord.EventId, sense).Value == Truth.True)
                    {
                        seen[sense].Add(observer);
                    }
                }
            }
            rows.Add((eventRecord.EventId, new Perceivers(seen[Sense.Sight], seen[Sense.Hearing], seen[Sense.Smell], seen[Sense.Touch], unknown)));
        }
        return rows;
    }

    // Whether any of these observers could sense any of `fresh`, by the rule `EventPerceivers` applies: a covered sense
    // answers true before or after. `events` is every event of the command so far, for perceive to find them in.
    public static bool SensedBy(
        Snapshot before,
        Snapshot after,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events,
        IReadOnlyList<WorldEvent> fresh,
        IReadOnlyList<string> observers)
    {
        var senses = Sense.All.Where(sense => after.Coverage.Senses.Contains(sense)).ToList();
        foreach (var eventRecord in fresh)
        {
            foreach (var observer in observers)
            {
                foreach (var sense in senses)
                {
                    foreach (var snapshot in new[] { before, after })
                    {
                        if (snapshot.Entities.ContainsKey(observer)
                            && Perceive(snapshot, registry, events, observer, eventRecord.EventId, sense).Value == Truth.True)
                        {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}
