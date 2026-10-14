using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Json;

// The only snapshot serializer: sorted keys at every depth (ordinal), no whitespace, integers only, no null member (an absent
// field and a null one are the same), strings escaped minimally (a lone surrogate as a unicode escape, so the output is always valid
// JSON). It writes a `Value`; a JSON node is read into one first.
public static class CanonicalJson
{
    public static string Serialize(JsonNode? node) => Serialize(ValueJson.FromNode(node));

    // Null only at the top, where an answer may be nothing at all.
    public static string Serialize(Value? value)
    {
        var text = new StringBuilder();
        Write(text, value);
        return text.ToString();
    }

    private static void Write(StringBuilder text, Value? value)
    {
        switch (value)
        {
            case null:
                text.Append("null");
                break;
            case Value.Map map:
                text.Append('{');
                var first = true;
                foreach (var (key, field) in map.Fields)
                {
                    if (!first)
                    {
                        text.Append(',');
                    }
                    first = false;
                    WriteString(text, key);
                    text.Append(':');
                    Write(text, field);
                }
                text.Append('}');
                break;
            case Value.List list:
                text.Append('[');
                for (var index = 0; index < list.Items.Length; index += 1)
                {
                    if (index > 0)
                    {
                        text.Append(',');
                    }
                    Write(text, list.Items[index]);
                }
                text.Append(']');
                break;
            case Value.Text content:
                WriteString(text, content.Content);
                break;
            case Value.Bool flag:
                text.Append(flag.Flag ? "true" : "false");
                break;
            case Value.Int number:
                text.Append(number.Number.ToString(CultureInfo.InvariantCulture));
                break;
            default:
                throw new NotSupportedException($"Cannot serialize {value.GetType().Name}");
        }
    }

    private static void WriteString(StringBuilder text, string value)
    {
        text.Append('"');
        for (var index = 0; index < value.Length; index += 1)
        {
            var c = value[index];
            switch (c)
            {
                case '"': text.Append("\\\""); break;
                case '\\': text.Append("\\\\"); break;
                case '\b': text.Append("\\b"); break;
                case '\f': text.Append("\\f"); break;
                case '\n': text.Append("\\n"); break;
                case '\r': text.Append("\\r"); break;
                case '\t': text.Append("\\t"); break;
                default:
                    if (c < 0x20 || char.IsSurrogate(c) && !IsPairAt(value, index))
                    {
                        // A lone surrogate has no UTF-8 form, so it is escaped.
                        text.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else if (char.IsHighSurrogate(c))
                    {
                        text.Append(c).Append(value[index + 1]);
                        index += 1;
                    }
                    else
                    {
                        text.Append(c);
                    }
                    break;
            }
        }
        text.Append('"');
    }

    private static bool IsPairAt(string value, int index) =>
        char.IsHighSurrogate(value[index]) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]);
}
