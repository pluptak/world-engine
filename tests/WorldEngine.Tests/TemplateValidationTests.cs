using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
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
                Props: Value.Map.Empty.With("scenery", true).With("surface", true),
                BreakProducts: [],
                BreakResidue: new Dictionary<string, long>()),
        };

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(decls));

        Assert.Equal("bare props.scenery cannot go with surface", error.Message);
    }

    private static string InvalidRoot =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "invalid-templates");
}

public class PropTests
{
    [Fact]
    public void Table_matches_the_TypeScript_table_exactly()
    {
        var golden = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "fields.json"));

        Meaning.Same(JsonNode.Parse(golden), WorldJson.Write(Prop.Table));
    }

    [Theory]
    [InlineData(PropType.Boolean, "true", true)]
    [InlineData(PropType.Boolean, "1", false)]
    [InlineData(PropType.Integer, "3", true)]
    [InlineData(PropType.Integer, "\"3\"", false)]
    [InlineData(PropType.String, "\"x\"", true)]
    [InlineData(PropType.String, "true", false)]
    public void Prop_values_match_their_declared_type(PropType type, string json, bool expected) =>
        Assert.Equal(expected, Prop.Matches(type, ValueJson.FromNode(JsonNode.Parse(json))));

    [Fact]
    public void A_typed_read_gives_the_value_only_when_it_has_the_type()
    {
        var props = Value.Map.Empty.With("on", false).With("fuel", "3").With("hunger", 7L).With("from", 1L);

        Assert.False(props.Is(Prop.On));
        Assert.Equal(false, props.Get(Prop.On));
        Assert.Null(props.Get(Prop.Open));
        Assert.Null(props.Get(Prop.Fuel));
        Assert.Equal(7, props.Get(Prop.Hunger));
        Assert.Null(props.Get(Prop.From));
    }

    [Fact]
    public void A_write_copies_the_props_and_leaves_the_original()
    {
        var props = Value.Map.Empty.With(Prop.Closing, true);

        var shut = props.Without(Prop.Closing).With(Prop.Open, false);

        Assert.Equal("""{"open":false}""", CanonicalJson.Serialize(shut));
        Assert.True(props.Is(Prop.Closing));
    }

    // A prop the engine reads goes through its descriptor, never a props bag indexed by a literal key.
    [Fact]
    public void No_source_reads_or_writes_a_prop_by_a_literal_key()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(root.FullName, "WorldEngine.slnx")))
        {
            root = root.Parent!;
        }
        var access = new System.Text.RegularExpressions.Regex(
            """[Pp]rops\??(\.(GetValueOrDefault|TryGetValue|ContainsKey|Remove)\(|\[)"[a-z_]""");

        var found = Directory.EnumerateFiles(Path.Combine(root.FullName, "src"), "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .SelectMany(path => File.ReadLines(path).Where(line => access.IsMatch(line)).Select(line => $"{Path.GetFileName(path)}: {line.Trim()}"))
            .ToList();

        Assert.Empty(found);
    }
}
