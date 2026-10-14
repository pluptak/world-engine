using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Engine.JsonReads;

namespace WorldEngine.Core.Engine;

// What an observer senses of the world (src/engine/projection.ts): the entities it could sense now, the parts of a body, one
// entity in detail, the level a look reads of an amount, and where a heard sound came from. Every answer is `perceive`'s own,
// so a projection can never say more than the queries it is made of. The projections are built as JSON, since their fields are
// optional with null meaning something (a reference to nothing, a position not known), and the JSON is what callers receive.
public static class Projection
{
    // The props a look reads as a level rather than a figure (src/engine/projection.ts `READ_AS_LEVEL`).
    private static readonly Prop<long>[] ReadAsLevel = [Prop.LiquidAmount, Prop.Fuel];

    // Quarters by sight; a gauge (`gauge_pct`) marks finer steps.
    private const double SightStepPct = 25;

    // Where a heard sound came from, by the basis of the hearing that is true: the observer's own room, or through a doorway.
    // Any other basis for a true hearing is a rule this table does not know.
    public static string HeardFrom(Code basis) => basis switch
    {
        Code.SameLocation => "here",
        Code.AdjacentLoudEvent => "next_door",
        Code.Intercom => "intercom",
        _ => throw new InvalidOperationException($"Hearing is true with basis {basis}"),
    };

    // The door a sound heard from the next room came through: the first doorway joining the observer's room to the event's room,
    // in id order. Null in the observer's own room, for an event whose entity is gone, or when no door joins the two rooms.
    public static string? HearingDoor(Snapshot snapshot, string observerId, WorldEvent @event)
    {
        if (!snapshot.Entities.TryGetValue(observerId, out var observer) || !snapshot.Entities.TryGetValue(@event.Entity, out var subject))
        {
            return null;
        }
        var target = @event.Data.TryGetValue("location", out var location) && Text(location) is { } named ? named : subject.Location;
        var here = observer.Location;
        if (here is null || target is null || here == target)
        {
            return null;
        }
        return snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .FirstOrDefault(id =>
            {
                var entity = snapshot.Entities[id];
                return Resolve.IsDoor(entity) && Reach.DoorJoins(entity.Props, here, target);
            });
    }

    // What one observer senses of each entity now: the entities it sees, feels or smells, with the senses that tell it, and the
    // facts of an entity it sees or feels. A thing makes no sound by being there, so hearing is reported for events only.
    public static List<JsonObject> ObserveEntities(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events,
        string observer)
    {
        var covered = Capabilities.Senses
            .Where(sense => sense != Sense.Hearing && snapshot.Coverage.Senses.Contains(sense))
            .ToList();
        var sensed = new List<(string Id, List<string> Senses)>();
        foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            var senses = covered
                .Where(sense => Perception.Perceive(snapshot, registry, observer, id, sense).Value == Truth.True)
                .ToList();
            if (senses.Count > 0)
            {
                sensed.Add((id, senses));
            }
        }
        var sensedIds = sensed.Select(entry => entry.Id).ToHashSet(StringComparer.Ordinal);
        var relations = snapshot.Coverage.Relations;
        var properties = snapshot.Coverage.Properties;
        var here = snapshot.Entities.TryGetValue(observer, out var self) ? self.Location : null;

        // A reference names another observed entity, the observer's own room, or nothing; a reference to anything else is left
        // out rather than leaked, so it reports whether it may be shown at all.
        bool Shown(string? id, out JsonNode? node)
        {
            if (id is null)
            {
                node = null;
                return true;
            }
            node = JsonValue.Create(id);
            return sensedIds.Contains(id) || id == here;
        }

        var result = new List<JsonObject>(sensed.Count);
        foreach (var (id, senses) in sensed)
        {
            var entity = snapshot.Entities[id];
            var observed = new JsonObject
            {
                ["id"] = id,
                ["template"] = entity.Template,
                ["name"] = entity.Name,
                ["senses"] = Strings(senses),
            };
            if (!senses.Contains(Sense.Sight) && !senses.Contains(Sense.Touch))
            {
                result.Add(observed);
                continue;
            }
            var facts = new JsonObject();
            // A relation left empty is none (a null field is an absent one); one that names what may not be shown is listed in
            // `hidden`, so a caller never reads "not shown" as "none".
            var hidden = new List<string>();
            void Link(string field, string? value)
            {
                if (!relations.Contains(field))
                {
                    return;
                }
                if (Shown(value, out var node))
                {
                    facts[field] = node;
                }
                else
                {
                    hidden.Add(field);
                }
            }
            Link("location", entity.Location);
            Link("support", entity.Support);
            Link("contained_in", entity.ContainedIn);
            if (hidden.Count > 0)
            {
                facts["hidden"] = Strings(hidden);
            }
            // Which hand or pocket rides with the holder it names: no holder shown, no part shown.
            if (facts.ContainsKey("contained_in"))
            {
                facts["in_part"] = entity.InPart;
            }
            if (relations.Contains("status"))
            {
                facts["status"] = WorldJson.Name(entity.Status);
            }
            if (properties.Contains("integrity"))
            {
                facts["integrity"] = JsonValue.Create(entity.Integrity);
            }
            if (properties.Contains("residue"))
            {
                facts["residue"] = new JsonObject(entity.Residue.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)JsonValue.Create(pair.Value))));
            }
            if (properties.Contains("pos"))
            {
                facts["pos"] = Position(Geometry.EffectivePos(snapshot, id));
            }
            observed["facts"] = facts;
            result.Add(observed);
        }
        return result;
    }

    // The parts of a body whose template declares some, in declaration order, as an observer who sees or feels it could tell.
    // Part status is a fact like an entity's status, so a world that does not cover that relation shows no parts.
    public static JsonArray? BodyParts(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId)
    {
        if (!snapshot.Entities.TryGetValue(entityId, out var entity)
            || !registry.TryGetValue(entity.Template, out var template)
            || template.Parts.Count == 0)
        {
            return null;
        }
        if (!snapshot.Coverage.Relations.Contains("status"))
        {
            return null;
        }
        var withIntegrity = snapshot.Coverage.Properties.Contains("integrity");
        var parts = new JsonArray();
        foreach (var decl in template.Parts)
        {
            var state = PartStates.Effective(template, entity, decl.Name)!;
            var part = new JsonObject
            {
                ["name"] = decl.Name,
                ["status"] = WorldJson.Name(state.Status),
            };
            if (withIntegrity)
            {
                part["integrity"] = JsonValue.Create(state.Integrity);
            }
            parts.Add(part);
        }
        return parts;
    }

    // The parts of a body the observer sees or feels now, or null: sight and touch are the senses that tell how a thing stands.
    public static JsonArray? VisibleParts(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string observer, string entityId)
    {
        if (!snapshot.Entities.TryGetValue(entityId, out var entity)
            || !registry.TryGetValue(entity.Template, out var template)
            || template.Parts.Count == 0)
        {
            return null;
        }
        var feels = new[] { Sense.Sight, Sense.Touch }.Any(sense =>
            snapshot.Coverage.Senses.Contains(sense)
            && Perception.Perceive(snapshot, registry, observer, entityId, sense).Value == Truth.True);
        return feels ? BodyParts(snapshot, registry, entityId) : null;
    }

    // One entity in more detail than observe lists it, for a controller asking about a single thing: the same senses and facts,
    // the props the world covers, whether the observer could reach it, what it is made of, and what it visibly holds. Null when
    // the observer senses nothing of it.
    public static JsonObject? InspectEntity(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events,
        string observer,
        string entityId)
    {
        var observed = ObserveEntities(snapshot, registry, events, observer);
        var found = observed.FirstOrDefault(candidate => candidate["id"]!.GetValue<string>() == entityId);
        if (found is null || !snapshot.Entities.TryGetValue(entityId, out var entity))
        {
            return null;
        }
        var inspection = (JsonObject)found.DeepClone();
        if (snapshot.Coverage.Relations.Contains("reachable"))
        {
            inspection["reachable"] = JsonValue.Create(Reach.InReach(snapshot, observer, entityId));
        }
        if (found["facts"] is null)
        {
            return inspection;
        }
        var props = new JsonObject();
        foreach (var key in entity.Props.Keys.Order(StringComparer.Ordinal))
        {
            if (snapshot.Coverage.Properties.Contains(key) && !ReadAsLevel.Any(prop => prop.Name == key))
            {
                props[key] = entity.Props[key]?.DeepClone();
            }
        }
        inspection["props"] = props;

        // The amounts a look reads as a level: the gauge's step where the thing has one, else quarters.
        var step = entity.Props.Get(Prop.GaugePct) ?? SightStepPct;
        var levels = new JsonObject();
        foreach (var prop in ReadAsLevel)
        {
            if (snapshot.Coverage.Properties.Contains(prop)
                && Number(entity.Props.GetValueOrDefault(prop)) is { } amount
                && FullOf(entity, registry, prop) is { } full)
            {
                levels[prop] = Level(amount, full, step);
            }
        }
        if (levels.Count > 0)
        {
            inspection["levels"] = levels;
        }
        if (entity.Traits is { } traits)
        {
            inspection["traits"] = new JsonObject(traits.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)JsonValue.Create(pair.Value))));
        }
        if (registry.TryGetValue(entity.Template, out var template))
        {
            inspection["size_cm"] = new JsonObject
            {
                ["w"] = JsonValue.Create(template.SizeCm.W),
                ["d"] = JsonValue.Create(template.SizeCm.D),
                ["h"] = JsonValue.Create(template.SizeCm.H),
            };
        }
        if (BodyParts(snapshot, registry, entityId) is { } parts)
        {
            inspection["parts"] = parts;
        }
        inspection["holds"] = new JsonArray([.. observed
            .Where(other => other["facts"] is JsonObject facts
                && (facts["contained_in"]?.GetValue<string>() == entityId || facts["support"]?.GetValue<string>() == entityId))
            .Select(other => (JsonNode?)JsonValue.Create(other["id"]!.GetValue<string>()))]);
        return inspection;
    }

    // An amount as a look reads it: the band of whole percentages of what full is that it falls in, so the same amount always
    // reads the same. Empty and full read exactly.
    public static JsonObject Level(double amount, double full, double step)
    {
        if (amount <= 0)
        {
            return Band(0, 0);
        }
        if (amount >= full)
        {
            return Band(100, 100);
        }
        var low = Math.Floor(100 * amount / (full * step)) * step;
        return Band(low, Math.Min(low + step, 100));
    }

    private static JsonObject Band(double min, double max) => new()
    {
        ["min_pct"] = JsonValue.Create(min),
        ["max_pct"] = JsonValue.Create(max),
    };

    // What full is for an amount: a vessel's liquid capacity, or a light's fuel as its template declares it. Null when nothing
    // says, so the thing gives no level.
    private static double? FullOf(Entity entity, IReadOnlyDictionary<string, Template> registry, Prop<long> prop)
    {
        if (prop == Prop.LiquidAmount)
        {
            return PourVerb.LiquidCapacity(entity);
        }
        var declared = registry.TryGetValue(entity.Template, out var template)
            ? template.Props.Get(Prop.Fuel)
            : null;
        return declared is { } fuel && fuel > 0 ? fuel : null;
    }

    private static JsonNode? Position(Pos? pos) => pos is null
        ? null
        : new JsonObject { ["x"] = JsonValue.Create(pos.X), ["y"] = JsonValue.Create(pos.Y) };

    private static JsonArray Strings(IEnumerable<string> values) =>
        new([.. values.Select(value => (JsonNode?)JsonValue.Create(value))]);
}
