using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Reads of the JSON a scenario, scene or query is written in. The boundary checks the shape, so a value the port reads that is
// missing or of another type comes back null.
public static class JsonReads
{
    // A copy with every null member left out, at any depth: an absent field and a null one are the same. Numbers are kept as they
    // are, so a fraction still reaches whatever refuses it.
    public static JsonNode? WithoutNulls(JsonNode? node) => node switch
    {
        JsonObject record => new JsonObject(record
            .Where(pair => pair.Value is not null)
            .Select(pair => KeyValuePair.Create(pair.Key, WithoutNulls(pair.Value)))),
        JsonArray list => new JsonArray([.. list.Select(WithoutNulls)]),
        _ => node?.DeepClone(),
    };

    public static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    // A number, whether it was parsed from text or built in code: a whole number is read as one, anything else as a double.
    // (A node built from a long does not convert to a double through TryGetValue, nor one built from an int to either, so the
    // text is the last resort.)
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
        return value.TryGetValue(out double fraction)
            ? fraction
            : double.Parse(value.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);
    }

    // A whole number that fits a long; null otherwise.
    public static long? SafeInt(JsonNode? node) =>
        Number(node) is { } number && IsWhole(number)
            ? (long)number
            : null;

    // A flag that is literally true, as `=== true` reads it; any other value, or none, is not.
    public static bool IsTrue(JsonNode? node) => node is JsonValue value && value.GetValueKind() is JsonValueKind.True;
}
