using System.Text.Json;
using System.Text.Json.Nodes;

namespace WorldEngine.Core.Engine;

// Reads one prop by its JSON kind, the way the TypeScript checks do: `=== true`, `typeof x === "string"`, and so on.
// A prop that is absent, or stored as null, is none of these.
public static class PropValues
{
    public static bool IsTrue(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        Kind(props, key) is JsonValueKind.True;

    public static bool IsFalse(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        Kind(props, key) is JsonValueKind.False;

    public static bool IsString(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        Kind(props, key) is JsonValueKind.String;

    public static bool IsNumber(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        Kind(props, key) is JsonValueKind.Number;

    public static string? GetString(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        IsString(props, key) ? props[key]!.GetValue<string>() : null;

    public static double? GetNumber(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        IsNumber(props, key) ? JsonReads.Number(props[key]) : null;

    private static JsonValueKind? Kind(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        props.TryGetValue(key, out var value) ? value?.GetValueKind() : null;
}
