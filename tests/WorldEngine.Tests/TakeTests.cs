using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// `apply` of the take verb (src/engine/verbs/take.ts through src/engine/pipeline.ts), whole results compared with
// TypeScript: the front, the reach, gap and carry refusals, the grip checks, the weight check, and the reveal of what
// the item hid. The commands and worlds are the ones Fixtures/take-golden.expected.json holds.
public class TakeTests
{
    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["advance"] = TimeVerbs.Advance,
        ["take"] = TakeVerb.Take,
    };

    [Fact]
    public void Take_results_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("take-golden.expected.json"))!.AsArray();
        Assert.NotEmpty(rows);
        var snapshots = new Dictionary<string, Snapshot>(StringComparer.Ordinal);

        foreach (var row in rows)
        {
            var name = row!["snapshot"]!.GetValue<string>();
            if (!snapshots.TryGetValue(name, out var snapshot))
            {
                snapshot = WorldJson.Read<Snapshot>(ReadFixture($"{name}.snapshot.json"));
                snapshots[name] = snapshot;
            }
            var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());
            var label = $"{name} {command.CommandId}";

            var result = Pipeline.Apply(snapshot, Registry, Verbs, command);

            Assert.True(
                CanonicalJson.Serialize(row["result"]) == WorldJson.Write(Shape(result)),
                $"{label}: the result differs from TypeScript's");
        }
    }

    private static Dictionary<string, object?> Shape(Pipeline.Result result)
    {
        var shape = new Dictionary<string, object?>
        {
            ["status"] = result.Status.ToString().ToLowerInvariant(),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
            ["snapshot"] = result.Snapshot,
            ["deltas"] = result.Deltas,
            ["events"] = result.Events,
        };
        if (result.ReasonCode is not null)
        {
            shape["reason_code"] = result.ReasonCode;
        }
        if (result.ReasonData is not null)
        {
            shape["reason_data"] = result.ReasonData;
        }
        return shape;
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
