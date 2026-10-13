using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Authored beats (src/engine/beats.ts): an intention kept in the schedule as a cause of kind `beat`. When it falls due it
// becomes ordinary events, so every observer senses it as any others. A beat is data: its action is one of a closed set,
// never code. The cause keeps the JSON the snapshot stores; it is read here when it runs, and checked by the same shape rules
// when it is stored.
public static partial class Beats
{
    // Beats the schedule may hold, counting each follower (src/engine/beats.ts MAX_BEATS).
    public const int MaxBeats = 256;

    // Levels of nesting, the beat itself counted: a beat, its `then`, theirs, and theirs (MAX_DEPTH).
    public const int MaxDepth = 4;

    // Runs a repeating beat may have after its first (MAX_REPEATS).
    public const int MaxRepeats = 1000;

    // Single conditions one `all` holds: from one to this many (MAX_ALL).
    public const int MaxAll = 16;

    private static readonly Regex BeatIdPattern = new("^[A-Za-z0-9_.:-]{1,64}\\z", RegexOptions.CultureInvariant);
    private static readonly HashSet<string> Ops = new(StringComparer.Ordinal) { "eq", "ne", "lt", "lte", "gt", "gte" };
    private static readonly HashSet<string> ActionEdits = new(StringComparer.Ordinal)
    {
        "spawn", "remove", "place", "set_props", "update_props", "set_part",
    };

    // What firing a beat did: the edit's first event, or the failure that stopped it with nothing written.
    private abstract record Fired;

    private sealed record Done(string? EventId) : Fired;

    private sealed record Failed(string Code) : Fired;

    // ---- Shape: what a stored beat may carry (parseScheduleBeat and what it calls). ----

    public static bool IsBeatId(string? id) => id is not null && BeatIdPattern.IsMatch(id);

    // A number that is a whole number fitting a long; null otherwise.
    private static long? SafeInt(JsonNode? node) =>
        PropFields.Number(node) is { } number && IsWhole(number)
            ? (long)number
            : null;

    private static string? TextOf(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    private static bool NonEmpty(JsonNode? node) => TextOf(node) is { Length: > 0 };

    private static bool IsBool(JsonNode? node) => node is JsonValue value && value.TryGetValue(out bool _);

    private static bool? BoolOf(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out bool flag) ? flag : null;

    private static bool OnlyKeys(JsonObject obj, params string[] allowed) => obj.All(pair => allowed.Contains(pair.Key));

}
