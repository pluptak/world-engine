using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// A round's planning (src/engine/round.ts planRound) and the pipeline's round and per-event perceiver behaviour, each row's result
// compared with TypeScript's (Fixtures/round-golden.expected.json, from scratchpad/gen/round-golden.mjs). A "plan" row names the
// round's status, its refusal code, the moves refused where it starts and the order the rest are taken in; a "command" row is one
// command's result as the pipeline gives it.
public class RoundGoldenTests
{
    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["advance"] = TimeVerbs.Advance,
        ["edit"] = EditVerb.Edit,
        ["open"] = OpenVerbs.Open,
        ["say"] = SayVerb.Say,
        ["take"] = TakeVerb.Take,
        ["wait"] = WaitVerb.Wait,
    };

    [Fact]
    public void Round_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("round-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var snapshot = WorldJson.Read<Snapshot>(row["snapshot"] is null
                ? row["input"]!["snapshot"]!.ToJsonString()
                : row["snapshot"]!.ToJsonString());
            var actual = row["kind"]!.GetValue<string>() switch
            {
                "plan" => Plan(snapshot, row["input"]!["moves"]!.AsArray()),
                "command" => Shape(Pipeline.Apply(snapshot, TestTemplates.RepoRegistry, Verbs, WorldJson.Read<Command>(row["command"]!.ToJsonString()))),
                var kind => throw new InvalidDataException($"{name}: unknown row kind {kind}"),
            };
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == CanonicalJson.Serialize(actual),
                $"{name}: the result differs from TypeScript's");
        }
    }

    // A round's plan as the golden writes it: its status and refusal, the moves refused where it starts by index, and the order.
    private static JsonNode Plan(Snapshot snapshot, JsonArray moves)
    {
        var commands = moves.Select(move => WorldJson.Read<Command>(move!.ToJsonString())).ToList();
        var plan = Round.PlanRound(snapshot, TestTemplates.RepoRegistry, Verbs, commands);
        var result = new JsonObject { ["status"] = plan.Status.ToString().ToLowerInvariant() };
        if (plan.ReasonCode is not null)
        {
            result["reason_code"] = plan.ReasonCode;
        }
        result["early"] = new JsonArray([.. plan.Early
            .OrderBy(entry => entry.Key)
            .Select(entry => (JsonNode?)new JsonObject { ["index"] = JsonValue.Create(entry.Key), ["result"] = Shape(entry.Value) })]);
        result["order"] = new JsonArray([.. plan.Order.Select(index => (JsonNode?)JsonValue.Create(index))]);
        return result;
    }

    // A pipeline result in the shape the goldens compare.
    private static JsonNode Shape(Pipeline.Result result) => JsonNode.Parse(WorldJson.Write(PipelineShape.Of(result)))!;
}
