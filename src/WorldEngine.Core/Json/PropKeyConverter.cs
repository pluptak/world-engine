using System.Text.Json;
using System.Text.Json.Serialization;
using WorldEngine.Core.Engine;

namespace WorldEngine.Core.Json;

// A prop in JSON is its key; reading one back finds the prop the engine declares under that key.
public sealed class PropKeyConverter : JsonConverterFactory
{
    public override bool CanConvert(Type type) => type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Prop<>);

    public override JsonConverter CreateConverter(Type type, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(typeof(KeyConverter<>).MakeGenericType(type.GetGenericArguments()))!;

    private sealed class KeyConverter<T> : JsonConverter<Prop<T>>
    {
        public override Prop<T> Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
            reader.GetString() is { } name && Prop.Table.TryGetValue(name, out var field)
                ? new Prop<T>(name, field)
                : throw new JsonException($"No prop {reader.GetString()}");

        public override void Write(Utf8JsonWriter writer, Prop<T> value, JsonSerializerOptions options) => writer.WriteStringValue(value.Name);
    }
}
