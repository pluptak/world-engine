using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

public class ValueTests
{
    private sealed record Holder(Value Held, Value? Absent = null);

    [Fact]
    public void Lists_and_maps_compare_by_content()
    {
        var one = Read("""{"b":[1,"x",true],"a":{"c":2}}""");
        var two = Read("""{"a":{"c":2},"b":[1,"x",true]}""");

        Assert.Equal(one, two);
        Assert.Equal(one.GetHashCode(), two.GetHashCode());
        Assert.NotEqual(one, Read("""{"a":{"c":2},"b":[1,"x",false]}"""));
        Assert.NotEqual(Read("[1,2]"), Read("[2,1]"));
    }

    [Fact]
    public void A_map_walks_its_keys_in_ordinal_order()
    {
        var map = Assert.IsType<Value.Map>(Read("""{"b":1,"a":2,"B":3}"""));

        Assert.Equal(["B", "a", "b"], map.Fields.Keys);
    }

    [Fact]
    public void A_null_member_reads_as_an_absent_one()
    {
        Assert.Equal(Read("""{"a":1}"""), Read("""{"a":1,"b":null}"""));
    }

    [Fact]
    public void A_null_in_a_list_and_a_fraction_are_refused()
    {
        Assert.Throws<FormatException>(() => Read("[1,null]"));
        Assert.Throws<FormatException>(() => Read("1.5"));
        Assert.Throws<FormatException>(() => Read("9223372036854775808"));
    }

    [Fact]
    public void A_record_holding_a_value_reads_and_writes_it_through_the_world_options()
    {
        var holder = new Holder(Read("""{"z":[1,{"y":"text"}],"a":false}"""));
        var text = WorldJson.Write(holder);

        Assert.Equal("""{"held":{"a":false,"z":[1,{"y":"text"}]}}""", text);
        Assert.Equal(holder.Held, WorldJson.Read<Holder>(text).Held);
        Assert.Null(WorldJson.Read<Holder>(text).Absent);
    }

    // Every snapshot fixture, read as a value, writes back as the canonical JSON of the same snapshot with its null members left
    // out, and reads again to an equal value.
    [Fact]
    public void Every_snapshot_fixture_round_trips()
    {
        var files = Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures"), "*.snapshot.json");
        Assert.NotEmpty(files);
        foreach (var file in files)
        {
            var node = JsonNode.Parse(File.ReadAllText(file));
            var value = ValueJson.FromNode(node)!;

            Assert.Equal(CanonicalJson.Serialize(WithoutNulls(node)), CanonicalJson.Serialize(value));
            Assert.Equal(value, ValueJson.FromNode(JsonNode.Parse(CanonicalJson.Serialize(value))));
        }
    }

    private static Value Read(string json) => ValueJson.FromNode(JsonNode.Parse(json))!;

    private static JsonNode? WithoutNulls(JsonNode? node) => node switch
    {
        JsonObject record => new JsonObject(record
            .Where(pair => pair.Value is not null)
            .Select(pair => KeyValuePair.Create(pair.Key, WithoutNulls(pair.Value)))),
        JsonArray list => new JsonArray([.. list.Select(WithoutNulls)]),
        _ => node?.DeepClone(),
    };
}
