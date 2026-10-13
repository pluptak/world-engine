using System.Text.Json;
using System.Text.Json.Nodes;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Reads of the JSON a scenario, scene or query is written in. The boundary checks the shape, so a value the port reads that is
// missing or of another type comes back null.
public static class JsonReads
{
    public static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    // A number, whether it was parsed from text or built in code: a whole number is read as one, anything else as a double.
    // (A node built from a long does not convert to a double through TryGetValue, so the two are tried in turn.)
    public static double? Number(JsonNode? node)
    {
        if (node is not JsonValue value || value.GetValueKind() != JsonValueKind.Number)
        {
            return null;
        }
        if (value.TryGetValue(out long whole))
        {
            return whole;
        }
        return value.TryGetValue(out double fraction) ? fraction : null;
    }

    // A whole number that fits a long; null otherwise.
    public static long? SafeInt(JsonNode? node) =>
        Number(node) is { } number && IsWhole(number)
            ? (long)number
            : null;
}
