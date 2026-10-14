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

    // Registered in `WorldJson.Options`, so any record holding a `Value` reads and writes it.
    public sealed class Converter : JsonConverter<Value>
    {
        public override bool HandleNull => false;

        public override Value? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            FromNode(JsonNode.Parse(ref reader));

        public override void Write(Utf8JsonWriter writer, Value value, JsonSerializerOptions options) =>
            (ToNode(value) ?? throw new JsonException("A value is never null")).WriteTo(writer);
    }
}
