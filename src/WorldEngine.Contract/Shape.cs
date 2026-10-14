using WorldEngine.Core.Model;

namespace WorldEngine.Contract;

// A check of one value's shape, built from the pieces below. A record shape is strict: a member it does not name is refused, and one
// it names with `Opt` may be absent. A value holds no null and no fraction, so neither is ever a shape's to refuse.
internal delegate bool Shape(Value? value);

internal sealed record Field(Shape Shape, bool Optional);

internal static class Shapes
{
    public static readonly Shape Text = value => value is Value.Text;
    public static readonly Shape NonEmpty = value => value.AsText() is { Length: > 0 };
    public static readonly Shape Bool = value => value is Value.Bool;
    public static readonly Shape Int = value => value is Value.Int;
    public static readonly Shape Record = value => value is Value.Map;

    public static Shape Between(long low, long high) => value => value.AsInt() is { } number && number >= low && number <= high;

    public static Shape AtLeast(long low) => Between(low, long.MaxValue);

    public static Shape Const(string text) => value => value.AsText() == text;

    public static Shape OneOfText(params string[] texts) => value => value.AsText() is { } text && texts.Contains(text);

    public static Shape Or(params Shape[] shapes) => value => shapes.Any(shape => shape(value));

    public static Shape List(Shape item) => value => value is Value.List list && list.Items.All(element => item(element));

    public static Field Req(Shape shape) => new(shape, false);

    public static Field Opt(Shape shape) => new(shape, true);

    public static Shape Obj(params (string Name, Field Field)[] fields)
    {
        var byName = fields.ToDictionary(pair => pair.Name, pair => pair.Field, StringComparer.Ordinal);
        return value =>
        {
            if (value is not Value.Map record)
            {
                return false;
            }
            foreach (var (name, member) in record)
            {
                if (!byName.TryGetValue(name, out var field) || !field.Shape(member))
                {
                    return false;
                }
            }
            return byName.All(pair => pair.Value.Optional || record.ContainsKey(pair.Key));
        };
    }
}
