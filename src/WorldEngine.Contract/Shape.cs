using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;

namespace WorldEngine.Contract;

// A check of one JSON value's shape, built from the pieces below. An object shape is strict: a member it does not name is refused, and one
// it names with `Opt` may be absent but is never null unless its check allows null.
internal delegate bool Shape(JsonNode? node);

internal sealed record Field(Shape Shape, bool Optional);

internal static class Shapes
{
    public static readonly Shape Text = node => JsonReads.Text(node) is not null;
    public static readonly Shape NonEmpty = node => JsonReads.Text(node) is { Length: > 0 };
    public static readonly Shape Bool = node => node is JsonValue value && value.GetValueKind() is JsonValueKind.True or JsonValueKind.False;
    public static readonly Shape Number = node => JsonReads.Number(node) is not null;
    public static readonly Shape Int = node => JsonReads.Number(node) is { } number && Integers.IsWhole(number);
    public static readonly Shape Record = node => node is JsonObject;

    public static Shape Between(long low, long high) =>
        node => JsonReads.Number(node) is { } number && Integers.IsWhole(number) && number >= low && number <= high;

    public static Shape AtLeast(long low) => Between(low, long.MaxValue);

    public static Shape Const(string text) => node => JsonReads.Text(node) == text;

    public static Shape OneOfText(params string[] texts) => node => JsonReads.Text(node) is { } text && texts.Contains(text);

    public static Shape Null(Shape shape) => node => node is null || shape(node);

    public static Shape Or(params Shape[] shapes) => node => shapes.Any(shape => shape(node));

    public static Shape List(Shape item) => node => node is JsonArray list && list.All(element => item(element));

    public static Field Req(Shape shape) => new(shape, false);

    public static Field Opt(Shape shape) => new(shape, true);

    public static Shape Obj(params (string Name, Field Field)[] fields)
    {
        var byName = fields.ToDictionary(pair => pair.Name, pair => pair.Field, StringComparer.Ordinal);
        return node =>
        {
            if (node is not JsonObject record)
            {
                return false;
            }
            foreach (var (name, value) in record)
            {
                if (!byName.TryGetValue(name, out var field) || !field.Shape(value))
                {
                    return false;
                }
            }
            return byName.All(pair => pair.Value.Optional || record.ContainsKey(pair.Key));
        };
    }
}
