using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Model;

// The world's state (src/model.ts). Field names are the TypeScript names, in snake_case on the wire.
// Schedule, run and event types are not yet ported.

public sealed record Pos(long X, long Y);

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
    long? Rng);
