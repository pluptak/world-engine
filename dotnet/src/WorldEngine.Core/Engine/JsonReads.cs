using System.Text.Json;
using System.Text.Json.Nodes;

namespace WorldEngine.Core.Engine;

// Reads of the JSON a scenario or scene is written in. The boundary checks the shape, so a value the port reads that is
// missing or of another type comes back null.
internal static class JsonReads
{
    private const long MaxSafeInteger = 9007199254740991;

    public static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    // A whole number within the safe range, as `Number.isSafeInteger` reads it; null otherwise.
    public static long? SafeInt(JsonNode? node) =>
        node is JsonValue value
        && value.GetValueKind() == JsonValueKind.Number
        && value.TryGetValue(out double number)
        && Math.Floor(number) == number
        && Math.Abs(number) <= MaxSafeInteger
            ? (long)number
            : null;
}
