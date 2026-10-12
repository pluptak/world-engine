using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The state one command builds up while it runs (src/engine/pipeline.ts `emit` and `set`): the working snapshot, the
// events the command emitted, and the deltas that record each field change under the event that made it.
public sealed class Working
{
    private readonly string commandId;

    public Working(Snapshot snapshot, string commandId)
    {
        Snapshot = snapshot;
        this.commandId = commandId;
    }

    public Snapshot Snapshot { get; private set; }

    public List<WorldEvent> Events { get; } = [];

    public List<Delta> Deltas { get; } = [];

    // Allocates the next event id, stamps it with the working tick, and returns its id for the events it causes.
    public string Emit(string type, string entity, IReadOnlyDictionary<string, JsonNode?> data, string? causeId)
    {
        if (!Snapshot.Entities.ContainsKey(entity) && entity != Resolve.WorldAuthor)
        {
            throw new InvalidOperationException($"Cannot emit an event for unknown entity {entity}");
        }
        var eventId = $"ev{Snapshot.NextSeq}";
        var copy = data.ToDictionary(entry => entry.Key, entry => entry.Value?.DeepClone());
        Events.Add(new WorldEvent(eventId, causeId, commandId, Snapshot.Tick, type, entity, copy));
        Snapshot = Snapshot with { NextSeq = Snapshot.NextSeq + 1 };
        return eventId;
    }

    // Replaces an entity's modifiers. A change is recorded as a delta under `eventId`; setting the same list is a no-op.
    public void SetModifiers(string entityId, IReadOnlyList<Modifier> modifiers, string eventId)
    {
        var entity = Snapshot.Entities[entityId];
        var from = JsonSerializer.SerializeToNode(entity.Modifiers, WorldJson.Options);
        var to = JsonSerializer.SerializeToNode(modifiers, WorldJson.Options);
        if (CanonicalJson.Serialize(from) == CanonicalJson.Serialize(to))
        {
            return;
        }
        Deltas.Add(new Delta(eventId, entityId, "modifiers", from, to));
        var entities = new Dictionary<string, Entity>(Snapshot.Entities, StringComparer.Ordinal)
        {
            [entityId] = entity with { Modifiers = modifiers },
        };
        Snapshot = Snapshot with { Entities = entities };
    }

    // Sets one of the entity's id-valued relations (`set` in src/engine/pipeline.ts): a delta under `eventId` when the
    // value changes, nothing when it does not.
    public void SetRelation(string entityId, string field, string? value, string eventId)
    {
        var entity = Snapshot.Entities[entityId];
        var (current, updated) = field switch
        {
            "contained_in" => (entity.ContainedIn, entity with { ContainedIn = value }),
            "in_part" => (entity.InPart, entity with { InPart = value }),
            "support" => (entity.Support, entity with { Support = value }),
            "concealed_by" => (entity.ConcealedBy, entity with { ConcealedBy = value }),
            "location" => (entity.Location, entity with { Location = value }),
            _ => throw new ArgumentException($"Not a relation: {field}", nameof(field)),
        };
        if (current == value)
        {
            return;
        }
        Deltas.Add(new Delta(eventId, entityId, field, current is null ? null : JsonValue.Create(current), value is null ? null : JsonValue.Create(value)));
        var entities = new Dictionary<string, Entity>(Snapshot.Entities, StringComparer.Ordinal) { [entityId] = updated };
        Snapshot = Snapshot with { Entities = entities };
    }

    // Sets the entity's position (a `pos` delta when it changes, as `SetRelation` does).
    public void SetPos(string entityId, Pos? pos, string eventId)
    {
        var entity = Snapshot.Entities[entityId];
        if (entity.Pos == pos)
        {
            return;
        }
        Deltas.Add(new Delta(
            eventId,
            entityId,
            "pos",
            entity.Pos is null ? null : JsonSerializer.SerializeToNode(entity.Pos, WorldJson.Options),
            pos is null ? null : JsonSerializer.SerializeToNode(pos, WorldJson.Options)));
        var entities = new Dictionary<string, Entity>(Snapshot.Entities, StringComparer.Ordinal) { [entityId] = entity with { Pos = pos } };
        Snapshot = Snapshot with { Entities = entities };
    }

    public void SetTick(long tick) => Snapshot = Snapshot with { Tick = tick };

    public void BumpVersion() => Snapshot = Snapshot with { Version = Snapshot.Version + 1 };
}
