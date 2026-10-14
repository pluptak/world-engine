using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The fact half of a query (src/engine/query.ts `fact`, `partFact`) and the event form of perceive across a command
// (`queryAtEvent`), each row's answer compared with TypeScript's (Fixtures/query-golden.expected.json, from
// scratchpad/gen/query-golden.mjs). An answer is its value and the basis that decided it.
public class QueryGoldenTests
{
    private static readonly IReadOnlyDictionary<string, Template> Registry = TestTemplates.RepoRegistry;

    [Fact]
    public void Query_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("query-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var actual = row["kind"]!.GetValue<string>() switch
            {
                "fact" => Fact(WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString()), input["query"]!),
                "at_event" => AtEvent(input),
                var kind => throw new InvalidDataException($"{name}: unknown row kind {kind}"),
            };
            Meaning.Same(row["result"], actual, $"{name}: expected {row["result"]}, got {actual.ToJsonString()}");
        }
    }

    private static JsonNode Fact(Snapshot snapshot, JsonNode query)
    {
        var answer = Queries.Fact(
            snapshot,
            Registry,
            query["subject"]!.GetValue<string>(),
            query["relation"]!.GetValue<string>(),
            query["object"]?.GetValue<string>());
        return Answer(answer);
    }

    private static JsonNode AtEvent(JsonNode input)
    {
        var before = WorldJson.Read<Snapshot>(input["before"]!.ToJsonString());
        var after = WorldJson.Read<Snapshot>(input["after"]!.ToJsonString());
        var events = input["events"]!.AsArray().Select(item => WorldJson.Read<WorldEvent>(item!.ToJsonString())).ToList();
        var query = input["query"]!;
        var answer = Queries.AtEvent(
            before,
            after,
            Registry,
            events,
            query["observer"]!.GetValue<string>(),
            query["event_id"]!.GetValue<string>(),
            query["sense"]!.GetValue<string>());
        return Answer(answer);
    }

    private static JsonNode Answer(Perception.Answer answer) => new JsonObject
    {
        ["value"] = WorldJson.Name(answer.Value),
        ["basis_code"] = WorldJson.Name(answer.BasisCode),
    };
}
