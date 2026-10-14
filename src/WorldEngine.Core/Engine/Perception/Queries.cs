using System.Globalization;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The fact half of a query (src/engine/query.ts `fact`, `partFact`) and the event form of perceive across a command
// (`queryAtEvent`). A fact answers true, false or unknown with the basis that decided it, from the snapshot alone; nothing is
// written. The entity and event forms of perceive are in Perception and EventPerception.
public static class Queries
{
    // The one declared threshold for `near`: two positions in the same room this far apart or closer are near. Squared, so the
    // arithmetic stays integer.
    public const long NearThresholdCm = 100;

    // What the snapshot says of a subject: an entity, or a part addressed `<entity>.<part>`. The object is optional.
    public static Perception.Answer Fact(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string subject,
        string relation,
        string? obj)
    {
        if (!snapshot.Entities.TryGetValue(subject, out var entity))
        {
            return PartFact(snapshot, registry, subject, relation, obj);
        }
        if (snapshot.Coverage.Relations.Contains(relation))
        {
            if (relation == "near")
            {
                // Existence is modelled, so a bad object is false rather than unknown, and only the basis says which way it failed.
                if (obj is null)
                {
                    return new Perception.Answer(Truth.False, Code.NoObject);
                }
                if (!snapshot.Entities.TryGetValue(obj, out var other))
                {
                    return new Perception.Answer(Truth.False, Code.NoSuchEntity);
                }
                return Perception.Answer.Of(NearValue(snapshot, entity, other), Code.DerivedNear);
            }
            // Whether the subject could lay a hand on the object now, by the rule every verb that reaches applies.
            if (relation == "reachable")
            {
                if (obj is null)
                {
                    return new Perception.Answer(Truth.False, Code.NoObject);
                }
                if (!snapshot.Entities.ContainsKey(obj))
                {
                    return new Perception.Answer(Truth.False, Code.NoSuchEntity);
                }
                return Perception.Answer.Of(Reach.InReach(snapshot, entity.Id, obj), Code.DerivedReach);
            }
            return Perception.Answer.Of(RelationValue(registry, entity, relation, obj), Code.RelationState);
        }
        if (snapshot.Coverage.Properties.Contains(relation))
        {
            var (defined, value) = PropertyValue(entity, relation);
            return Perception.Answer.Of(PropertyMatches(defined, value, obj, relation), Code.PropertyState);
        }
        return new Perception.Answer(Truth.Unknown, Code.UncoveredCategory);
    }

    // Whether an observer senses an event at either end of its command: true before or after, else the answer after
    // (src/engine/query.ts `queryAtEvent`).
    public static Perception.Answer AtEvent(
        Snapshot before,
        Snapshot after,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events,
        string observerId,
        string eventId,
        string sense)
    {
        var afterAnswer = EventPerception.Perceive(after, registry, events, observerId, eventId, sense);
        if (afterAnswer.Value == Truth.True)
        {
            return afterAnswer;
        }
        var beforeAnswer = EventPerception.Perceive(before, registry, events, observerId, eventId, sense);
        return beforeAnswer.Value == Truth.True ? beforeAnswer : afterAnswer;
    }

    // Whether the entity holds the relation to the object (or any object, when none is named) as the snapshot stores it.
    private static bool RelationValue(IReadOnlyDictionary<string, Template> registry, Entity entity, string relation, string? obj)
    {
        switch (relation)
        {
            case "support":
                return obj is null ? entity.Support is not null : entity.Support == obj;
            case "contained_in":
                return obj is null ? entity.ContainedIn is not null : entity.ContainedIn == obj;
            case "location":
                return obj is null ? entity.Location is not null : entity.Location == obj;
            case "status":
                return obj is null || WorldJson.Name(entity.Status) == obj;
            case "attached_to":
            {
                registry.TryGetValue(entity.Template, out var template);
                if (obj is null)
                {
                    return (template?.Parts ?? []).Any(decl => Attached(PartStates.Effective(template, entity, decl.Name)));
                }
                if (entity.DetachedFrom is { } from && obj == from.Entity)
                {
                    return false;
                }
                // A part named as `<this entity>.<part>` is the part; a bare name is the part of this entity.
                var partName = obj.StartsWith(entity.Id + ".", StringComparison.Ordinal) ? obj[(entity.Id.Length + 1)..] : obj;
                return Attached(PartStates.Effective(template, entity, partName));
            }
            default:
                return false;
        }
    }

    // A fact about one part: its status, its integrity, and whether it is still attached to its entity. A part is not an
    // entity, so every other field is false with `not_a_part_field`.
    private static Perception.Answer PartFact(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string subject,
        string relation,
        string? obj)
    {
        var separator = subject.LastIndexOf('.');
        if (separator <= 0 || !snapshot.Entities.TryGetValue(subject[..separator], out var entity))
        {
            return new Perception.Answer(Truth.False, Code.NoSuchEntity);
        }
        registry.TryGetValue(entity.Template, out var template);
        var state = PartStates.Effective(template, entity, subject[(separator + 1)..]);
        if (state is null)
        {
            return new Perception.Answer(Truth.False, Code.NoSuchPart);
        }
        var isRelation = snapshot.Coverage.Relations.Contains(relation);
        if (!isRelation && !snapshot.Coverage.Properties.Contains(relation))
        {
            return new Perception.Answer(Truth.Unknown, Code.UncoveredCategory);
        }
        // A part is not an entity: of the relations only its status and what it is attached to mean anything, and of the
        // properties only its integrity is read.
        if (!isRelation)
        {
            return relation == "integrity"
                ? Perception.Answer.Of(PropertyMatches(true, state.Integrity, obj, "integrity"), Code.PartState)
                : new Perception.Answer(Truth.False, Code.NotAPartField);
        }
        var attached = Attached(state);
        return relation switch
        {
            "status" => Perception.Answer.Of(obj is null || WorldJson.Name(state.Status) == obj, Code.PartState),
            "attached_to" => Perception.Answer.Of(attached && (obj is null || obj == entity.Id), Code.PartState),
            _ => new Perception.Answer(Truth.False, Code.NotAPartField),
        };
    }

    // A part is attached while it is neither detached nor destroyed.
    private static bool Attached(PartState? state) => state is not null && state.Status is not (PartStatus.Detached or PartStatus.Destroyed);

    // `near` is read off two positions every time it is asked: both need a position through their support or containment chain,
    // in the same room.
    private static bool NearValue(Snapshot snapshot, Entity entity, Entity other)
    {
        if (entity.Location is null || entity.Location != other.Location)
        {
            return false;
        }
        var here = Geometry.EffectivePos(snapshot, entity.Id);
        var there = Geometry.EffectivePos(snapshot, other.Id);
        return here is not null && there is not null && WithinThreshold(here, there);
    }

    private static bool WithinThreshold(Pos here, Pos there)
    {
        var dx = here.X - there.X;
        var dy = here.Y - there.Y;
        return dx * dx + dy * dy <= NearThresholdCm * NearThresholdCm;
    }

    // A property as the entity holds it, with `Defined` false when the entity has no such property at all. An absent position is
    // defined, and reads as none.
    private static (bool Defined, Value? Value) PropertyValue(Entity entity, string property) => property switch
    {
        "integrity" => (true, entity.Integrity),
        "residue" => (true, Value.Of(entity.Residue.Select(pair => KeyValuePair.Create(pair.Key, (Value?)pair.Value)))),
        "pos" => (true, entity.Pos is { } pos ? Value.Of([KeyValuePair.Create("x", (Value?)pos.X), KeyValuePair.Create("y", (Value?)pos.Y)]) : null),
        _ => entity.Props.TryGetValue(property, out var value) ? (true, value) : (false, null),
    };

    // Whether a defined value matches the object: a plain match, a number or boolean written as its text, a list or map written as
    // its canonical JSON, or, for residue, a positive amount of the named material. An absent position matches `null`.
    private static bool PropertyMatches(bool defined, Value? value, string? obj, string property)
    {
        if (!defined)
        {
            return false;
        }
        if (obj is null)
        {
            return true;
        }
        return value switch
        {
            Value.Map residue when property == "residue" => residue.GetValueOrDefault(obj).AsInt() > 0,
            null => obj == "null",
            Value.Text text => text.Content == obj,
            Value.Int number => number.Number.ToString(CultureInfo.InvariantCulture) == obj,
            Value.Bool flag => (flag.Flag ? "true" : "false") == obj,
            _ => CanonicalJson.Serialize(value) == obj,
        };
    }
}
