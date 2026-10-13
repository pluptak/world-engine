using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// `apply` of the pour verb (src/engine/verbs/pour.ts through src/engine/pipeline.ts), whole results compared with
// TypeScript: a full bottle of wine poured onto a table, into an open chest, onto the floor, all of it and part of it;
// a closed chest, a far chest, a stone, the bottle itself, a missing or unresolved destination, a part and a carried
// stone as the source; an empty bottle; a chest holding water (incompatible) and one holding wine with a small capacity
// (full). The commands and worlds are the ones Fixtures/pour-golden.expected.json holds.
public class PourTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["pour"] = PourVerb.Pour,
    };

    [Fact]
    public void Pour_results_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("pour-golden.expected.json"))!.AsArray();
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
        if (result.Candidates is not null)
        {
            shape["candidates"] = result.Candidates;
        }
        return shape;
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
