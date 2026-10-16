using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Authored beats (src/engine/beats.ts): an intention kept in the schedule as a cause of kind `beat`. When it falls due it
// becomes ordinary events, so every observer senses it as any others. A beat is data: its action is one of a closed set,
// never code. A beat an edit or a scene writes is read into its records and held to the shape rules there, as a stored one is.
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

    private static bool NonEmpty(string? text) => text is { Length: > 0 };
}
