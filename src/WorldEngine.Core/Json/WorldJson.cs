using System.Text.Json;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Json;

// How snapshots meet JSON: snake_case names, enums as strings, and an unknown field
// is an error rather than a value silently dropped on the way through.
public static class WorldJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        Converters = { new JsonStringEnumConverter() },
    };

    public static T Read<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new JsonException($"Empty {typeof(T).Name}");

    public static string Write<T>(T value) =>
        CanonicalJson.Serialize(JsonSerializer.SerializeToNode(value, Options));
}
