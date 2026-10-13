using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The behaviours that were refused as not ported, each row's result compared with TypeScript's (Fixtures/gap-golden.expected.json,
// from scratchpad/gen/gap-golden.ts on the shipped templates plus Fixtures/test-templates): a chance process that rolls, a process
// that removes its entity, a destroyed body's successor, a beat edit with no cause, a spawn with an explicit null `in_part`, and a
// spawn with a trait that is not a string.
public class GapGoldenTests
{
    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["advance"] = TimeVerbs.Advance,
        ["edit"] = EditVerb.Edit,
    };

    [Fact]
    public void Gap_rows_match_TypeScript()
    {
        var rows = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "gap-golden.expected.json")))!.AsArray();
        Assert.Equal(7, rows.Count);

        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var snapshot = WorldJson.Read<Snapshot>(row["snapshot"]!.ToJsonString());
            var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());
            var result = Pipeline.Apply(snapshot, TestTemplates.Registry, Verbs, command);
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == WorldJson.Write(PipelineShape.Of(result)),
                $"{name}: the result differs from TypeScript's");
        }
    }
}
