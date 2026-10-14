using System.Text.Json.Nodes;
using WorldEngine.Core.Json;

namespace WorldEngine.Tests;

public class CanonicalJsonTests
{
    [Fact]
    public void Sorts_keys_at_every_depth_by_code_unit()
    {
        var node = JsonNode.Parse("""{"b":1,"a":[2,{"d":false,"c":true}],"B":"x"}""");

        Assert.Equal("""{"B":"x","a":[2,{"c":true,"d":false}],"b":1}""", CanonicalJson.Serialize(node));
    }

    // An absent field and a null one are the same (`Value`), so a null member is never written; a null in a list has no such
    // reading and is refused.
    [Fact]
    public void Leaves_a_null_member_out_and_refuses_a_null_in_a_list()
    {
        Assert.Equal("""{"a":{},"b":1}""", CanonicalJson.Serialize(JsonNode.Parse("""{"b":1,"a":{"c":null},"d":null}""")));
        Assert.Equal("null", CanonicalJson.Serialize((JsonNode?)null));
        Assert.Throws<FormatException>(() => CanonicalJson.Serialize(JsonNode.Parse("[1,null]")));
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
