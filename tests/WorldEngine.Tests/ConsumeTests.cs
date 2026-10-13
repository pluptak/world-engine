using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// `apply` of the consume verb (src/engine/verbs/consume.ts through src/engine/pipeline.ts), whole results compared with
// TypeScript: a liquid drunk by the amount or whole (with the hunger it lowers, or none where the actor declares none),
// the refusals of the amount and the item, bread eaten a portion at a time, and a bottle drunk from a table within
// reach. The commands and worlds are the ones Fixtures/consume-golden.expected.json holds. A solid's last portion uses
// it up (`Physical.SpendEntity`): Fixtures/consume-spent-golden.expected.json holds a stale bread eaten in the hand and
// on a table, where the stone resting on it is released; its template is a test template (Fixtures/test-templates), not
// one the repo ships.
public class ConsumeTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["advance"] = TimeVerbs.Advance,
        ["consume"] = ConsumeVerb.Consume,
    };

    [Fact]
    public void Consume_results_match_TypeScript() => AssertMatchesTypeScript("consume-golden.expected.json");

    [Fact]
    public void Consume_of_the_last_portion_matches_TypeScript() => AssertMatchesTypeScript("consume-spent-golden.expected.json");

    private static void AssertMatchesTypeScript(string golden)
    {
        var rows = JsonNode.Parse(ReadFixture(golden))!.AsArray();
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
