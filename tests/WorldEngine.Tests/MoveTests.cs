using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// `apply` of the move verb (src/engine/verbs/move.ts through src/engine/pipeline.ts), whole results compared with
// TypeScript: a walk to a position in the room (clear, blocked by a rag, out of its footprint, onto the spot it is on),
// a walk through a shut door (refused) and an open one (through its name or its alias, or to the room beyond), a room
// that is not a room, an unknown room, an unresolved door, a thing that is not a door, and the malformed arguments.
// The commands and worlds are the ones Fixtures/move-golden.expected.json holds.
public class MoveTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["move"] = MoveVerb.Move,
    };

    [Fact]
    public void Move_results_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("move-golden.expected.json"))!.AsArray();
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
