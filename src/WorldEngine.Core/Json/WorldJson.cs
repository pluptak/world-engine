using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Json;

// How snapshots meet JSON: snake_case names, enums as snake_case strings (`Name` gives one outside a record), and an unknown field
// is an error rather than a value silently dropped on the way through.
public static class WorldJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        // An absent optional field is left out; a field every record carries, even empty (an entity's `location`, an event's
        // `cause_id`), says `JsonIgnoreCondition.Never` and is written as null.
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Canonical JSON sorts keys, so a stored cause's `kind` comes after fields that sort before it.
        AllowOutOfOrderMetadataProperties = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) },
    };

    public static string Name<T>(T value)
        where T : struct, Enum => JsonNamingPolicy.SnakeCaseLower.ConvertName(value.ToString());

    // The member a snake_case name stands for; a name with no member throws.
    public static T Parse<T>(string name)
        where T : struct, Enum => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(name), Options);

    public static T Read<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options)
        ?? throw new JsonException($"Empty {typeof(T).Name}");

    public static T Read<T>(JsonNode? node) =>
        node.Deserialize<T>(Options)
        ?? throw new JsonException($"Empty {typeof(T).Name}");

    public static string Write<T>(T value) =>
        CanonicalJson.Serialize(JsonSerializer.SerializeToNode(value, Options));
}
