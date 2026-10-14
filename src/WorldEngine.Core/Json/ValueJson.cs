using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Json;

// `Value` as JSON, both ways. A null member of an object is left out, as an absent one; a null in an array, and a number
// that is not a whole `long`, are refused.
public static class ValueJson
{
    public static Value? FromNode(JsonNode? node) => node switch
    {
        null => null,
        JsonObject record => Value.Of(record.Select(pair => KeyValuePair.Create(pair.Key, FromNode(pair.Value)))),
        JsonArray list => Value.Of(list.Select(item => FromNode(item) ?? throw new FormatException("A list holds no null"))),
        JsonValue scalar => FromScalar(scalar),
        _ => throw new NotSupportedException($"Cannot read {node.GetType().Name}"),
    };

    // A record as a value, as the world's JSON options write it: how a delta holds the field it changed.
    public static Value? Of<T>(T value) => FromNode(JsonSerializer.SerializeToNode(value, WorldJson.Options));

    // A value read into a record as the world's JSON options read it; a member the record does not have, or a value of another
    // type, throws.
    public static T Read<T>(Value value) => WorldJson.Read<T>(ToNode(value));

    // A value read into a record as the world's JSON options read it: false when it is not one (a member the record does not
    // have, or a value of another type).
    public static bool TryRead<T>(Value value, [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out T? read)
        where T : class
    {
        try
        {
            read = ToNode(value).Deserialize<T>(WorldJson.Options);
            return read is not null;
        }
        catch (JsonException)
        {
            read = null;
            return false;
        }
    }

    // A node read as a value when it can be one; false for a fraction or a null in a list.
    public static bool TryFromNode(JsonNode? node, out Value? value)
    {
        try
        {
            value = FromNode(node);
            return true;
        }
        catch (FormatException)
        {
            value = null;
            return false;
        }
    }

    public static JsonNode? ToNode(Value? value) => value switch
    {
        null => null,
        Value.Bool flag => JsonValue.Create(flag.Flag),
        Value.Int number => JsonValue.Create(number.Number),
        Value.Text text => JsonValue.Create(text.Content),
        Value.List list => new JsonArray([.. list.Items.Select(ToNode)]),
        Value.Map map => new JsonObject(map.Fields.Select(pair => KeyValuePair.Create(pair.Key, ToNode(pair.Value)))),
        _ => throw new NotSupportedException($"Cannot write {value.GetType().Name}"),
    };

    private static Value FromScalar(JsonValue scalar)
    {
        switch (scalar.GetValueKind())
        {
            case JsonValueKind.String:
                return scalar.GetValue<string>();
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.Number:
                // The digits are read from the text, since a number set in code may not convert to a long.
                var digits = scalar.ToJsonString();
                return long.TryParse(digits, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var number)
                    ? number
                    : throw new FormatException($"Not a whole number: {digits}");
            default:
                throw new NotSupportedException($"Cannot read {scalar.GetValueKind()}");
        }
    }

    // Registered in `WorldJson.Options`, so any record holding a `Value`, or one kind of it (a `Value.Map` of props), reads and
    // writes it. A value of another kind than the field declares does not read.
    public sealed class Converter : JsonConverterFactory
    {
        public override bool CanConvert(Type typeToConvert) => typeof(Value).IsAssignableFrom(typeToConvert);

        public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
            (JsonConverter)Activator.CreateInstance(typeof(Of<>).MakeGenericType(typeToConvert))!;

        private sealed class Of<T> : JsonConverter<T>
            where T : Value
        {
            public override bool HandleNull => false;

            public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
                FromNode(JsonNode.Parse(ref reader)) switch
                {
                    null => null,
                    T value => value,
                    var other => throw new JsonException($"Expected {typeof(T).Name}, read {other.GetType().Name}"),
                };

            public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) =>
                (ToNode(value) ?? throw new JsonException("A value is never null")).WriteTo(writer);
        }
    }
}
