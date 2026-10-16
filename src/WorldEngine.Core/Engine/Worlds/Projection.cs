using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What an observer senses of the world (src/engine/projection.ts): the entities it could sense now, the parts of a body, one
// entity in detail, the level a look reads of an amount, and where a heard sound came from. Every answer is `perceive`'s own,
// so a projection can never say more than the queries it is made of. A field left empty is one the observer has nothing to say of.
public static class Projection
{
    // What one observer senses now and of the events it asked about.
    public sealed record Observation(
        string Observer,
        long Version,
        IReadOnlyList<string> UnknownSenses,
        IReadOnlyList<ObservedEntity> Entities,
        IReadOnlyList<SensedEvent> Events);

    // An entity sensed, with the senses that tell it; the facts only when one of them is sight or touch.
    public sealed record ObservedEntity(
        string Id,
        string Template,
        string Name,
        IReadOnlyList<string> Senses,
        Facts? Facts = null);

    // What sight or touch tells of an entity, each only where the world covers it. A relation that names what may not be shown is
    // listed in `Hidden`, so a caller never reads "not shown" as "none".
    public sealed record Facts(
        string? Location,
        string? Support,
        string? ContainedIn,
        IReadOnlyList<string>? Hidden,
        string? InPart,
        EntityStatus? Status,
        long? Integrity,
        IReadOnlyDictionary<string, long>? Residue,
        Pos? Pos);

    // An event sensed. One heard alone says where it came from (`From`, `HeardFrom`) and not whose it is (`Entity`).
    public sealed record SensedEvent(
        string EventId,
        long Tick,
        string Type,
        IReadOnlyList<string> Senses,
        string? From = null,
        string? HeardFrom = null,
        string? Entity = null,
        string? Utterance = null,
        string? Volume = null);

    // One entity in detail: what observe lists of it, and with its facts, what else a look or a touch tells.
    public sealed record Inspection(
        string Id,
        string Template,
        string Name,
        IReadOnlyList<string> Senses,
        Facts? Facts,
        bool? Reachable,
        Value.Map? Props = null,
        IReadOnlyDictionary<string, Band>? Levels = null,
        IReadOnlyDictionary<string, string>? Traits = null,
        Dimensions? SizeCm = null,
        IReadOnlyList<PartView>? Parts = null,
        IReadOnlyList<string>? Holds = null);

    public sealed record PartView(string Name, PartStatus Status, long? Integrity);

    // The band of whole percentages of full an amount reads as.
    public sealed record Band(long MinPct, long MaxPct);

    // The props a look reads as a level rather than a figure (src/engine/projection.ts `READ_AS_LEVEL`).
    private static readonly Prop<long>[] ReadAsLevel = [Prop.LiquidAmount, Prop.Fuel];

    // Quarters by sight; a gauge (`gauge_pct`) marks finer steps.
    private const long SightStepPct = 25;

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
        var target = @event.Data.GetValueOrDefault("location").AsText() ?? subject.Location;
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
    public static List<ObservedEntity> ObserveEntities(
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

        var result = new List<ObservedEntity>(sensed.Count);
        foreach (var (id, senses) in sensed)
        {
            var entity = snapshot.Entities[id];
            var observed = new ObservedEntity(id, entity.Template, entity.Name, senses);
            if (!senses.Contains(Sense.Sight) && !senses.Contains(Sense.Touch))
            {
                result.Add(observed);
                continue;
            }
            // A reference names another observed entity, the observer's own room, or nothing; a reference to anything else is
            // left out rather than leaked, and listed as hidden.
            var hidden = new List<string>();
            string? Link(string field, string? value)
            {
                if (!relations.Contains(field) || value is null)
                {
                    return null;
                }
                if (sensedIds.Contains(value) || value == here)
                {
                    return value;
                }
                hidden.Add(field);
                return null;
            }
            var location = Link("location", entity.Location);
            var support = Link("support", entity.Support);
            var containedIn = Link("contained_in", entity.ContainedIn);
            var facts = new Facts(
                location,
                support,
                containedIn,
                hidden.Count > 0 ? hidden : null,
                // Which hand or pocket rides with the holder it names: no holder shown, no part shown.
                containedIn is null ? null : entity.InPart,
                relations.Contains("status") ? entity.Status : null,
                properties.Contains("integrity") ? entity.Integrity : null,
                properties.Contains("residue") ? entity.Residue : null,
                properties.Contains("pos") ? Geometry.EffectivePos(snapshot, id) : null);
            result.Add(observed with { Facts = facts });
        }
        return result;
    }

    // The parts of a body whose template declares some, in declaration order, as an observer who sees or feels it could tell.
    // Part status is a fact like an entity's status, so a world that does not cover that relation shows no parts.
    public static List<PartView>? BodyParts(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string entityId)
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
        return [.. template.Parts.Select(decl =>
        {
            var state = PartStates.Effective(template, entity, decl.Name)!;
            return new PartView(decl.Name, state.Status, withIntegrity ? state.Integrity : null);
        })];
    }

    // The parts of a body the observer sees or feels now, or null: sight and touch are the senses that tell how a thing stands.
    public static List<PartView>? VisibleParts(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string observer, string entityId)
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
    public static Inspection? InspectEntity(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events,
        string observer,
        string entityId)
    {
        var observed = ObserveEntities(snapshot, registry, events, observer);
        var found = observed.FirstOrDefault(candidate => candidate.Id == entityId);
        if (found is null || !snapshot.Entities.TryGetValue(entityId, out var entity))
        {
            return null;
        }
        var inspection = new Inspection(
            found.Id,
            found.Template,
            found.Name,
            found.Senses,
            found.Facts,
            snapshot.Coverage.Relations.Contains("reachable") ? Reach.Reaches(snapshot, observer, entityId) : null);
        if (found.Facts is null)
        {
            return inspection;
        }
        var props = entity.Props.Only(key => snapshot.Coverage.Properties.Contains(key) && !ReadAsLevel.Any(prop => prop.Name == key));

        // The amounts a look reads as a level: the gauge's step where the thing has one, else quarters.
        var step = entity.Props.Get(Prop.GaugePct) ?? SightStepPct;
        var levels = new Dictionary<string, Band>(StringComparer.Ordinal);
        foreach (var prop in ReadAsLevel)
        {
            if (snapshot.Coverage.Properties.Contains(prop)
                && entity.Props.Get(prop) is { } amount
                && FullOf(entity, registry, prop) is { } full)
            {
                levels[prop] = Level(amount, full, step);
            }
        }
        return inspection with
        {
            Props = props,
            Levels = levels.Count > 0 ? levels : null,
            Traits = entity.Traits,
            SizeCm = registry.TryGetValue(entity.Template, out var template) ? template.SizeCm : null,
            Parts = BodyParts(snapshot, registry, entityId),
            Holds = [.. observed
                .Where(other => other.Facts is { } facts && (facts.ContainedIn == entityId || facts.Support == entityId))
                .Select(other => other.Id)],
        };
    }

    // An amount as a look reads it: the band of whole percentages of what full is that it falls in, so the same amount always
    // reads the same. Empty and full read exactly.
    public static Band Level(long amount, long full, long step)
    {
        if (amount <= 0)
        {
            return new Band(0, 0);
        }
        if (amount >= full)
        {
            return new Band(100, 100);
        }
        var low = 100 * amount / (full * step) * step;
        return new Band(low, Math.Min(low + step, 100));
    }

    // What full is for an amount: a vessel's liquid capacity, or a light's fuel as its template declares it. Null when nothing
    // says, so the thing gives no level.
    private static long? FullOf(Entity entity, IReadOnlyDictionary<string, Template> registry, Prop<long> prop)
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
}
