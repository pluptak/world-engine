using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Each folder under Fixtures/invalid-templates is a set that must be refused. The messages come from the
// TypeScript loader run on the same folders (expected.json), so the refusal text is the reference's.
public class TemplateValidationTests
{
    public static IEnumerable<object[]> InvalidSets()
    {
        var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(InvalidRoot, "expected.json")))!.AsObject();
        foreach (var (name, message) in expected)
        {
            yield return new object[] { name, message!.GetValue<string>() };
        }
    }

    [Theory]
    [MemberData(nameof(InvalidSets))]
    public void Refuses_the_set_with_the_TypeScript_message(string name, string message)
    {
        var declared = TemplateDirectory.ReadDeclarations(Path.Combine(InvalidRoot, name));

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(declared));

        Assert.Equal(message, error.Message);
    }

    [Fact]
    public void A_scenery_prop_cannot_go_with_a_surface()
    {
        var decls = new Dictionary<string, TemplateDecl>
        {
            ["bare"] = new TemplateDecl(
                "bare",
                SizeCm: new Dimensions(1, 1, 1),
                MassG: 1,
                Parts: [],
                Props: new Dictionary<string, JsonNode?> { ["scenery"] = true, ["surface"] = true },
                BreakProducts: [],
                BreakResidue: new Dictionary<string, long>()),
        };

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(decls));

        Assert.Equal("bare props.scenery cannot go with surface", error.Message);
    }

    private static string InvalidRoot =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "invalid-templates");
}

public class PropFieldsTests
{
    [Fact]
    public void Table_matches_the_TypeScript_table_exactly()
    {
        var golden = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "fields.json"));

        Assert.Equal(CanonicalJson.Serialize(JsonNode.Parse(golden)), WorldJson.Write(PropFields.Table));
    }

    [Theory]
    [InlineData(PropType.Boolean, "true", true)]
    [InlineData(PropType.Boolean, "1", false)]
    [InlineData(PropType.Integer, "3", true)]
    [InlineData(PropType.Integer, "3.5", false)]
    [InlineData(PropType.Integer, "\"3\"", false)]
    [InlineData(PropType.String, "\"x\"", true)]
    [InlineData(PropType.String, "true", false)]
    public void Prop_values_match_their_declared_type(PropType type, string json, bool expected) =>
        Assert.Equal(expected, PropFields.Matches(type, JsonNode.Parse(json)));
}
