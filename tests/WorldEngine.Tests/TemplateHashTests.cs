using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The frozen templates.json of a world the TypeScript engine wrote, and the templates_hash its snapshot holds.
public class TemplateHashTests
{
    [Fact]
    public void Matches_the_hash_the_TypeScript_engine_wrote_into_the_snapshot()
    {
        var registry = ReadRegistry();
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture("bottle.snapshot.json"));

        Assert.Equal(snapshot.TemplatesHash, TemplateHash.Of(registry));
    }

    [Fact]
    public void Lineage_does_not_change_the_hash()
    {
        var withLineage = ReadRegistry();
        var withoutLineage = ReadRegistry();
        foreach (var template in withoutLineage.Select(pair => pair.Value!.AsObject()))
        {
            template.Remove("lineage");
        }

        Assert.Equal(TemplateHash.Of(withoutLineage), TemplateHash.Of(withLineage));
    }

    [Fact]
    public void A_changed_prop_changes_the_hash()
    {
        var registry = ReadRegistry();
        var before = TemplateHash.Of(registry);

        registry["bottle"]!["mass_g"] = 501;

        Assert.NotEqual(before, TemplateHash.Of(registry));
    }

    [Fact]
    public void Hashing_leaves_the_registry_unchanged()
    {
        var registry = ReadRegistry();
        var before = CanonicalJson.Serialize(registry);

        TemplateHash.Of(registry);

        Assert.Equal(before, CanonicalJson.Serialize(registry));
    }

    private static JsonObject ReadRegistry() =>
        (JsonObject)JsonNode.Parse(ReadFixture("bottle.templates.json"))!;

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
