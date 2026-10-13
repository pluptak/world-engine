using System.Text.Json.Nodes;
using WorldEngine.Core.Json;

namespace WorldEngine.Tests;

public class CanonicalJsonTests
{
    [Fact]
    public void Sorts_keys_at_every_depth_by_code_unit()
    {
        var node = JsonNode.Parse("""{"b":1,"a":[2,{"d":null,"c":true}],"B":"x"}""");

        Assert.Equal("""{"B":"x","a":[2,{"c":true,"d":null}],"b":1}""", CanonicalJson.Serialize(node));
    }

    [Fact]
    public void Escapes_strings_as_JSON_stringify_does()
    {
        // From node: JSON.stringify("\u001f\u2028\ud83d\ude00/\"\\\b\f\n\r\t"). System.Text.Json refuses a
        // lone surrogate in input, so the lone-surrogate branch is not reachable from parsed JSON.
        var node = JsonNode.Parse("""
            "\u001f\u2028\ud83d\ude00/\"\\\b\f\n\r\t"
            """);

        Assert.Equal("\"\\u001f\u2028\U0001F600/\\\"\\\\\\b\\f\\n\\r\\t\"", CanonicalJson.Serialize(node));
    }

    [Fact]
    public void Rejects_a_fraction()
    {
        var node = JsonNode.Parse("""{"x":1.5}""");

        Assert.Throws<FormatException>(() => CanonicalJson.Serialize(node));
    }
}
