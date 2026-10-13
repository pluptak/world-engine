using System.Text.Json.Nodes;
using WorldEngine.Core;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The scenario forms (src/engine/forms.ts) against TypeScript: every shipped template with each overrides shape of Fixtures/forms-golden
// .expected.json (scratchpad/gen/forms-golden.mjs) gives the same overrides or the same refusal, code and message, and the architect's
// check names the same field or prop.
public class FormsGoldenTests
{
    private static readonly JsonObject Golden =
        (JsonObject)JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "forms-golden.expected.json")))!;

    public static IEnumerable<object[]> FormRows() => Enumerable.Range(0, ((JsonArray)Golden["forms"]!).Count).Select(index => new object[] { index });

    public static IEnumerable<object[]> ArchitectRows() => Enumerable.Range(0, ((JsonArray)Golden["architect"]!).Count).Select(index => new object[] { index });

    [Fact]
    public void Form_fixtures_hold_rows()
    {
        Assert.NotEmpty((JsonArray)Golden["forms"]!);
        Assert.NotEmpty((JsonArray)Golden["architect"]!);
    }

    [Theory]
    [MemberData(nameof(FormRows))]
    public void A_form_converts_as_TypeScript_converts_it(int index)
    {
        var row = (JsonObject)((JsonArray)Golden["forms"]!)[index]!;
        var template = TestTemplates.RepoRegistry[row["template"]!.GetValue<string>()];
        var overrides = (JsonObject)row["overrides"]!.DeepClone();
        var at = row["index"]!.GetValue<int>();

        if (row["error"] is JsonObject error)
        {
            var thrown = Assert.Throws<WorldError>(() => Forms.Apply(template, overrides, at));
            Assert.Equal(error["code"]!.GetValue<string>(), thrown.Code);
            Assert.Equal(error["message"]!.GetValue<string>(), thrown.Message);
            return;
        }
        var converted = Forms.Apply(template, overrides, at);
        Assert.True(
            CanonicalJson.Serialize(row["result"]) == CanonicalJson.Serialize(converted),
            $"row {index} ({template.Id}): expected {row["result"]?.ToJsonString()}, got {converted.ToJsonString()}");
    }

    [Theory]
    [MemberData(nameof(ArchitectRows))]
    public void The_architect_names_the_same_field_as_TypeScript(int index)
    {
        var row = (JsonObject)((JsonArray)Golden["architect"]!)[index]!;
        var overrides = (JsonObject)row["overrides"]!.DeepClone();
        var expected = row["architect"]?.GetValue<string>();
        Assert.Equal(expected, Forms.ArchitectWrites(overrides));
    }
}
