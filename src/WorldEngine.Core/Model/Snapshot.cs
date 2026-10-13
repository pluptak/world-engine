using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Model;

// The world's state (src/model.ts). Field names are the TypeScript names, in snake_case on the wire.
// Schedule, run and event types are not yet ported.

public sealed record Pos(long X, long Y);

// A cause the world will run by itself at `DueTick` (src/model.ts `ScheduledCause`). The `close` and `bleed` kinds are
// ported; `bleed` names how many bleeds are still to come. The other kinds carry fields this record does not read, so a
// stored one is refused when the snapshot is read.
public sealed record ScheduledCause(
    long DueTick,
    string Kind,
    string Entity,
    string? CauseId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Remaining = null,
    // The process a `process` cause runs; absent on every other kind.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Process = null,
    // A `beat` cause's id, action, condition, followers and repeat, as the snapshot writes them; absent on every other kind.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Id = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonNode? Action = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonNode? OnlyIf = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonNode? Then = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonNode? Repeat = null);

public enum PartStatus
{
    [JsonStringEnumMemberName("intact")] Intact,
    [JsonStringEnumMemberName("damaged")] Damaged,
    [JsonStringEnumMemberName("detached")] Detached,
    [JsonStringEnumMemberName("destroyed")] Destroyed,
}

public enum EntityStatus
{
    [JsonStringEnumMemberName("intact")] Intact,
    [JsonStringEnumMemberName("broken")] Broken,
    [JsonStringEnumMemberName("destroyed")] Destroyed,
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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<JsonObject>? Pool = null,
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
