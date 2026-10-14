using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Model;

// The world's state (src/model.ts). Field names are the TypeScript names, in snake_case on the wire.
// Schedule, run and event types are not yet ported.

public sealed record Pos(long X, long Y);

// A cause the world will run by itself at `DueTick`, one record per kind; the stored `kind` says which, and a kind with no record
// does not read. `CauseId` is the event that scheduled it, which the events it runs name as their cause.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(CloseCause), CauseKind.Close)]
[JsonDerivedType(typeof(BleedCause), CauseKind.Bleed)]
[JsonDerivedType(typeof(ProcessCause), CauseKind.Process)]
[JsonDerivedType(typeof(BeatCause), CauseKind.Beat)]
public abstract record ScheduledCause(long DueTick, string Entity, string? CauseId)
{
    [JsonIgnore]
    public string Kind => this switch
    {
        CloseCause => CauseKind.Close,
        BleedCause => CauseKind.Bleed,
        ProcessCause => CauseKind.Process,
        _ => CauseKind.Beat,
    };
}

// A door or gate shutting by itself.
public sealed record CloseCause(long DueTick, string Entity, string? CauseId) : ScheduledCause(DueTick, Entity, CauseId);

// A wound's next bleed, and how many are still to come counting it.
public sealed record BleedCause(long DueTick, string Entity, string? CauseId, long Remaining) : ScheduledCause(DueTick, Entity, CauseId);

// The next step of a template process on its entity.
public sealed record ProcessCause(long DueTick, string Entity, string? CauseId, string Process) : ScheduledCause(DueTick, Entity, CauseId);

// An authored beat: its id, its action (an author's edit, or a sound, kept as written for the edit verb to read), and optionally its
// condition, followers and repeat, held to `Beats`' shape rules wherever one is made or read.
public sealed record BeatCause(
    long DueTick,
    string Entity,
    string? CauseId,
    string Id,
    JsonObject Action,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] BeatCondition? OnlyIf = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<BeatFollower>? Then = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] BeatRepeat? Repeat = null)
    : ScheduledCause(DueTick, Entity, CauseId);

public enum PartStatus
{
    Intact,
    Damaged,
    Detached,
    Destroyed,
}

public enum EntityStatus
{
    Intact,
    Broken,
    Destroyed,
}

public sealed record PartState(long Integrity, PartStatus Status);

public sealed record Modifier(string Capacity, long Delta, long? ExpiresAtTick, string CauseId);

public sealed record DetachedFrom(string Entity, string Part);

public sealed record Entity(
    string Id,
    string Template,
    string Name,
    IReadOnlyList<string> Aliases,
    string? Location,
    string? Support,
    string? ContainedIn,
    string? InPart,
    string? ConcealedBy,
    Pos? Pos,
    DetachedFrom? DetachedFrom,
    long Integrity,
    EntityStatus Status,
    IReadOnlyDictionary<string, PartState> Parts,
    IReadOnlyDictionary<string, long> Residue,
    IReadOnlyList<Modifier> Modifiers,
    // Each value is a number, a string or a boolean.
    IReadOnlyDictionary<string, JsonNode?> Props,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyDictionary<string, string>? Traits);

public sealed record Coverage(
    IReadOnlyList<string> Relations,
    IReadOnlyList<string> Senses,
    IReadOnlyList<string> Properties);

public sealed record Snapshot(
    long Version,
    long Tick,
    long NextSeq,
    string TemplatesHash,
    Coverage Coverage,
    IReadOnlyDictionary<string, Entity> Entities,
    // The dice's 32-bit state; absent in a world never given a seed.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    long? Rng,
    // What the world will do by itself, in run order; absent when nothing is pending (src/engine/pending.ts).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<ScheduledCause>? Schedule = null,
    // The run a scene made, absent when the world has none (src/model.ts `run`).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    Run? Run = null);

// A run's state and what it holds (src/model.ts `Run`, docs/run.md). A slot is one body id, or a list of several, as the
// snapshot stores it, so it is kept as JSON. A pool beat is a beat body with no tick, held as its JSON.
public sealed record Run(
    string State,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? TickLimit = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<JsonNode>? Slots = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<PoolBeat>? Pool = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<Odds>? Odds = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<Player>? Players = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<Steered>? Steered = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] RunEnd? Ended = null);

// The range a director may steer a device's odds within, as the scene gave it.
public sealed record Odds(string Entity, string Prop, long Min, long Max);

// A handle bound to one of a registering run's slots, by the slot's first body.
public sealed record Player(string Handle, string Slot);

// The value a director has steered a device's odds to.
public sealed record Steered(string Entity, string Prop, long Value);

// Why and when a run ended.
public sealed record RunEnd(string Reason, long Tick);
