using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Model;

// What a command is, what the log records for it, and what the world answers (src/engine/command.ts, src/model.ts).
// Command arguments and reason data are kept as JSON until the verbs that read them are ported.

public enum Status
{
    [JsonStringEnumMemberName("ok")] Ok,
    [JsonStringEnumMemberName("refused")] Refused,
    [JsonStringEnumMemberName("ambiguous")] Ambiguous,
    [JsonStringEnumMemberName("unresolved")] Unresolved,
    [JsonStringEnumMemberName("preempted")] Preempted,
    [JsonStringEnumMemberName("invalid")] Invalid,
}

public enum Role
{
    [JsonStringEnumMemberName("author")] Author,
    [JsonStringEnumMemberName("director")] Director,
    [JsonStringEnumMemberName("player")] Player,
}

// The role a command was sent under (`docs/roles.md`); absent for the author of a bare world.
public sealed record By(
    Role Role,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Handle = null);

// Where a logged command sits in a round (`docs/rounds.md`).
public sealed record RoundMark(
    long Number,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Place = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Close = null);

public sealed record Command(
    string CommandId,
    string Actor,
    string Verb,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Target = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, JsonNode?>? Args = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Perceivers = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Round = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] By? By = null);

// A command as the log holds it: refused and invalid ones too, with the version it was decided at.
public sealed record Attempt(
    Command Command,
    long BasedOnVersion,
    long Version,
    Status Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? ReasonCode = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, JsonNode?>? ReasonData = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Candidates = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] RoundMark? Round = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] By? By = null);
