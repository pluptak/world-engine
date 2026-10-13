using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

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

    public string CommandId => commandId;

    public Snapshot Snapshot { get; private set; }

    // What a failed attempt puts back: the snapshot, and how many events and deltas were written before it (src/engine/beats.ts).
    public readonly record struct Checkpoint(Snapshot Snapshot, int Events, int Deltas);

    public Checkpoint Mark() => new(Snapshot, Events.Count, Deltas.Count);

    public void Rollback(Checkpoint mark)
    {
        Snapshot = mark.Snapshot;
        Events.RemoveRange(mark.Events, Events.Count - mark.Events);
        Deltas.RemoveRange(mark.Deltas, Deltas.Count - mark.Deltas);
    }

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

    public void SetIntegrity(string entityId, long integrity, string eventId) =>
        Update(entityId, "integrity", integrity, eventId, entity => entity with { Integrity = integrity });

    public void SetParts(string entityId, IReadOnlyDictionary<string, PartState> parts, string eventId) =>
        Update(entityId, "parts", parts, eventId, entity => entity with { Parts = parts });

    public void SetTemplate(string entityId, string template, string eventId) =>
        Update(entityId, "template", template, eventId, entity => entity with { Template = template });

    public void SetStatus(string entityId, EntityStatus status, string eventId) =>
        Update(entityId, "status", status, eventId, entity => entity with { Status = status });

    public void SetProps(string entityId, IReadOnlyDictionary<string, JsonNode?> props, string eventId) =>
        Update(entityId, "props", props, eventId, entity => entity with { Props = props });

    public void SetResidue(string entityId, IReadOnlyDictionary<string, long> residue, string eventId) =>
        Update(entityId, "residue", residue, eventId, entity => entity with { Residue = residue });

    // Adds a new entity (`spawn` in src/engine/spawn.ts) and records it as one delta on the field "entity" under the
    // `spawned` event, which is caused by `causeEventId`. Returns the spawned event's id.
    // Spawns an entity under a cause; its delta is recorded under `deltaEventId` when one is given, else the spawn event.
    public (string Id, string EventId) SpawnUnder(
        IReadOnlyDictionary<string, Template> registry,
        string templateId,
        Spawn.Overrides overrides,
        string? causeEventId,
        string? deltaEventId = null)
    {
        var created = Spawn.Create(Snapshot, registry, templateId, overrides);
        Snapshot = created.Snapshot;
        var spawnedEvent = Emit("spawned", created.Id, Pipeline.Reason(("template", templateId)), causeEventId);
        Deltas.Add(new Delta(
            deltaEventId ?? spawnedEvent,
            created.Id,
            "entity",
            null,
            JsonSerializer.SerializeToNode(Snapshot.Entities[created.Id], WorldJson.Options)));
        return (created.Id, spawnedEvent);
    }

    // Records an entity's removal as one delta on the field "entity" under `eventId`, from the entity as it was to nothing.
    // The entity stays in the snapshot until `DropEntity`, so what a removal does first can still read it.
    public void RecordEntityRemoval(string entityId, Entity former, string eventId) =>
        Deltas.Add(new Delta(eventId, entityId, "entity", JsonSerializer.SerializeToNode(former, WorldJson.Options), null));

    // Takes an entity out of the snapshot (no delta: `RecordEntityRemoval` records it).
    public void DropEntity(string entityId)
    {
        var entities = new Dictionary<string, Entity>(Snapshot.Entities, StringComparer.Ordinal);
        entities.Remove(entityId);
        Snapshot = Snapshot with { Entities = entities };
    }

    // Writes one field of an entity: a delta under `eventId` when its canonical value changes, nothing when it does not.
    private void Update<T>(string entityId, string field, T value, string eventId, Func<Entity, Entity> apply)
    {
        var entity = Snapshot.Entities[entityId];
        var from = JsonSerializer.SerializeToNode(FieldOf(entity, field), WorldJson.Options);
        var to = JsonSerializer.SerializeToNode(value, WorldJson.Options);
        if (CanonicalJson.Serialize(from) == CanonicalJson.Serialize(to))
        {
            return;
        }
        Deltas.Add(new Delta(eventId, entityId, field, from, to));
        var entities = new Dictionary<string, Entity>(Snapshot.Entities, StringComparer.Ordinal) { [entityId] = apply(entity) };
        Snapshot = Snapshot with { Entities = entities };
    }

    private static object? FieldOf(Entity entity, string field) => field switch
    {
        "template" => entity.Template,
        "status" => entity.Status,
        "integrity" => entity.Integrity,
        "parts" => entity.Parts,
        "props" => entity.Props,
        "residue" => entity.Residue,
        _ => throw new ArgumentException($"Not a field this helper writes: {field}", nameof(field)),
    };

    public void SetTick(long tick) => Snapshot = Snapshot with { Tick = tick };

    // The pending causes, stored as no field at all when there are none (src/engine/pending.ts `withSchedule`).
    public void SetSchedule(IReadOnlyList<ScheduledCause> schedule) =>
        Snapshot = Snapshot with { Schedule = schedule.Count == 0 ? null : schedule };

    // Sets the dice's state (src/engine/verbs/edit.ts `set_seed`): the world's, not an entity's, so no delta.
    public void SetRng(long state) => Snapshot = Snapshot with { Rng = state };

    // One roll of the dice (src/engine/pipeline.ts `random`): a number in [0, 1), and the dice advanced. A world with no seed refuses
    // it with NoSeedError.
    public double Random()
    {
        if (Snapshot.Rng is not { } state)
        {
            throw new NoSeedError();
        }
        var (value, next) = Rng.Next((uint)state);
        SetRng(next);
        return value;
    }

    // Sets the run (src/engine/run.ts): the run is the world's record, so the event that made the change is its whole account.
    public void SetRun(Run run) => Snapshot = Snapshot with { Run = run };

    public void BumpVersion() => Snapshot = Snapshot with { Version = Snapshot.Version + 1 };
}
