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

    [Fact]
    public void Every_form_converts_as_TypeScript_converts_it()
    {
        var rows = (JsonArray)Golden["forms"]!;
        Assert.NotEmpty(rows);
        var differing = new List<string>();
        for (var index = 0; index < rows.Count; index++)
        {
            var row = (JsonObject)rows[index]!;
            var template = TestTemplates.RepoRegistry[row["template"]!.GetValue<string>()];
            var overrides = (JsonObject)row["overrides"]!.DeepClone();
            var at = row["index"]!.GetValue<int>();
            string actual;
            try
            {
                actual = CanonicalJson.Serialize(Forms.Apply(template, overrides, at));
            }
            catch (WorldError thrown)
            {
                actual = $"{WorldJson.Name(thrown.Code)}: {thrown.Message}";
            }
            var expected = row["error"] is JsonObject error
                ? $"{error["code"]!.GetValue<string>()}: {error["message"]!.GetValue<string>()}"
                : CanonicalJson.Serialize(row["result"]);
            if (actual != expected)
            {
                differing.Add($"row {index} ({template.Id}): expected {expected}, got {actual}");
            }
        }
        Assert.True(differing.Count == 0, $"{differing.Count} of {rows.Count} differ, first: {string.Join(" | ", differing.Take(6))}");
    }

    [Fact]
    public void The_architect_names_the_same_field_as_TypeScript()
    {
        var rows = (JsonArray)Golden["architect"]!;
        Assert.NotEmpty(rows);
        var differing = new List<string>();
        for (var index = 0; index < rows.Count; index++)
        {
            var row = (JsonObject)rows[index]!;
            var expected = row["architect"]?.GetValue<string>();
            var actual = Forms.ArchitectWrites((JsonObject)row["overrides"]!.DeepClone());
            if (actual != expected)
            {
                differing.Add($"row {index}: expected {expected ?? "null"}, got {actual ?? "null"}");
            }
        }
        Assert.True(differing.Count == 0, $"{differing.Count} of {rows.Count} differ, first: {string.Join(" | ", differing.Take(6))}");
    }
}
