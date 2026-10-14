using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Model;

// What happened in a transition (src/model.ts WorldEvent, Delta, Perceivers). An event's data is kept as JSON
// until the events that read it are ported.

// The batch form of perceive, per event: the agents that sensed it through each covered sense.
public sealed record Perceivers(
    IReadOnlyList<string> Sight,
    IReadOnlyList<string> Hearing,
    IReadOnlyList<string> Smell,
    IReadOnlyList<string> Touch,
    IReadOnlyList<string> UnknownSenses);

public sealed record WorldEvent(
    string EventId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? CauseId,
    string CommandId,
    long Tick,
    string Type,
    string Entity,
    IReadOnlyDictionary<string, JsonNode?> Data,
    Perceivers? Perceivers = null);

// One field of one entity changing, as an event set it: `from` and `to` are whatever the field held.
public sealed record Delta(
    string EventId,
    string Entity,
    string Field,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] JsonNode? From,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] JsonNode? To);
