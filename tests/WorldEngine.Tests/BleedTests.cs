using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The bleeding of a wound, through `apply` of the wait verb (src/engine/schedule.ts `bleed`, src/engine/harm.ts `hurt`),
// whole results compared with TypeScript: a wound bleeding three times over six ticks, each bleed naming the one before
// it and the last one ending the wound; the same wound in a body with five integrity, whose first bleed destroys it, and
// the bottle it holds falls from the dying hand and breaks. The commands and worlds are the ones
// Fixtures/bleed-golden.expected.json holds.
public class BleedTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["wait"] = WaitVerb.Wait,
    };

    [Fact]
    public void Bleed_results_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("bleed-golden.expected.json"))!.AsArray();
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
        if (result.Candidates is not null)
        {
            shape["candidates"] = result.Candidates;
        }
        return shape;
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
