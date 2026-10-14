using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Json;

// How the model meets JSON: snake_case names, enums as snake_case strings (`Name` gives one outside a record), and an unknown field
// is an error rather than a value silently dropped on the way through. Everything the model needs of JSON is said here, not on the
// records: a `Value`, a prop by its key, and a scheduled cause by its `kind`.
public static class WorldJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        // A null field is an absent one (`Value`), so it is never written.
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // Canonical JSON sorts keys, so a stored cause's `kind` comes after fields that sort before it.
        AllowOutOfOrderMetadataProperties = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower), new ValueJson.Converter(), new PropKeyConverter() },
        TypeInfoResolver = new DefaultJsonTypeInfoResolver { Modifiers = { Causes } },
    };

    // A scheduled cause is stored with its `kind` first among its fields, which says which record it reads into; the kind is not a
    // field of its own besides.
    private static void Causes(JsonTypeInfo info)
    {
        if (!typeof(ScheduledCause).IsAssignableFrom(info.Type))
        {
            return;
        }
        if (info.Type == typeof(ScheduledCause))
        {
            info.PolymorphismOptions = new JsonPolymorphismOptions
            {
                TypeDiscriminatorPropertyName = "kind",
                DerivedTypes =
                {
                    new JsonDerivedType(typeof(CloseCause), CauseKind.Close),
                    new JsonDerivedType(typeof(BleedCause), CauseKind.Bleed),
                    new JsonDerivedType(typeof(ProcessCause), CauseKind.Process),
                    new JsonDerivedType(typeof(BeatCause), CauseKind.Beat),
                },
            };
        }
        if (info.Kind == JsonTypeInfoKind.Object && info.Properties.FirstOrDefault(property => property.Name == "kind") is { } kind)
        {
            info.Properties.Remove(kind);
        }
    }

    public static string Name<T>(T value)
        where T : struct, Enum => JsonNamingPolicy.SnakeCaseLower.ConvertName(value.ToString());

    // The member a snake_case name stands for; a name with no member throws.
    public static T Parse<T>(string name)
        where T : struct, Enum => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(name), Options);

    // A record from its text. Text that is not the record (malformed, a member it does not have, a value of another type) is a
    // FormatException, so a caller past the codec need know nothing of the encoding.
    public static T Read<T>(string json) => Reading(() => JsonSerializer.Deserialize<T>(json, Options));

    public static T Read<T>(JsonNode? node) => Reading(() => node.Deserialize<T>(Options));

    // A record from a value, as from the text the value would be written as.
    public static T Read<T>(Value value) => Read<T>(ValueJson.ToNode(value));

    private static T Reading<T>(Func<T?> read)
    {
        try
        {
            return read() ?? throw new FormatException($"Empty {typeof(T).Name}");
        }
        catch (JsonException error)
        {
            throw new FormatException(error.Message, error);
        }
    }

    // A value as a JSON tree, for a caller that adds to it before it is written.
    public static JsonNode? Node<T>(T value) => JsonSerializer.SerializeToNode(value, Options);

    public static string Write<T>(T value) =>
        CanonicalJson.Serialize(JsonSerializer.SerializeToNode(value, Options));
}
