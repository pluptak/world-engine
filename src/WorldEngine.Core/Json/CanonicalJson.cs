using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Json;

// The only snapshot serializer: sorted keys at every depth (ordinal), no whitespace, integers only, strings escaped minimally
// (a lone surrogate as a unicode escape, so the output is always valid JSON).
public static class CanonicalJson
{
    public static string Serialize(JsonNode? node)
    {
        var text = new StringBuilder();
        Write(text, node);
        return text.ToString();
    }

    private static void Write(StringBuilder text, JsonNode? node)
    {
        switch (node)
        {
            case null:
                text.Append("null");
                break;
            case JsonObject record:
                text.Append('{');
                var first = true;
                foreach (var (key, value) in record.OrderBy(pair => pair.Key, StringComparer.Ordinal))
                {
                    if (!first)
                    {
                        text.Append(',');
                    }
                    first = false;
                    WriteString(text, key);
                    text.Append(':');
                    Write(text, value);
                }
                text.Append('}');
                break;
            case JsonArray list:
                text.Append('[');
                for (var index = 0; index < list.Count; index += 1)
                {
                    if (index > 0)
                    {
                        text.Append(',');
                    }
                    Write(text, list[index]);
                }
                text.Append(']');
                break;
            case JsonValue scalar:
                WriteScalar(text, scalar);
                break;
            default:
                throw new NotSupportedException($"Cannot serialize {node.GetType().Name}");
        }
    }

    private static void WriteScalar(StringBuilder text, JsonValue scalar)
    {
        switch (scalar.GetValueKind())
        {
            case JsonValueKind.String:
                WriteString(text, scalar.GetValue<string>());
                break;
            case JsonValueKind.True:
                text.Append("true");
                break;
            case JsonValueKind.False:
                text.Append("false");
                break;
            case JsonValueKind.Number:
                // Snapshots hold integers only (AGENTS.md). The digits are read from the text, since a number set in
                // code may not convert to a long.
                var digits = scalar.ToJsonString();
                if (!long.TryParse(digits, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long integer))
                {
                    throw new FormatException($"Not a safe integer: {digits}");
                }
                text.Append(integer.ToString(CultureInfo.InvariantCulture));
                break;
            default:
                throw new NotSupportedException($"Cannot serialize {scalar.GetValueKind()}");
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
