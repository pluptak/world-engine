using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The world author's edits (src/engine/verbs/edit.ts) on one small valid world: each result, whole, compared with TypeScript's
// (Fixtures/edit-golden.expected.json, from scratchpad/gen/edit-golden.mjs). The edits covered are the ported kinds; the
// refused ones name the code TypeScript gives, and the loud refusals of unported edits are not in the golden.
public class EditTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["edit"] = EditVerb.Edit,
    };

    [Fact]
    public void Edit_results_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("edit-golden.expected.json"))!.AsArray();
        Assert.NotEmpty(rows);
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture("edit-base.snapshot.json"));

        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());

            var result = Pipeline.Apply(snapshot, Registry, Verbs, command);

            Meaning.Same(row["result"], WorldJson.Write(PipelineShape.Of(result)), $"{name}: the result differs from TypeScript's");
        }
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
