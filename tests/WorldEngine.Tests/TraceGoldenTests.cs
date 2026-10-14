using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The cause chain of an event and the trace of a field (src/engine/trace.ts), each row's result compared with TypeScript's
// (Fixtures/trace-golden.expected.json, from scratchpad/gen/trace-golden.mjs). A refusal is compared by its code and message.
public class TraceGoldenTests
{
    [Fact]
    public void Trace_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("trace-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var events = input["events"]!.AsArray().Select(item => WorldJson.Read<WorldEvent>(item!.ToJsonString())).ToList();
            var actual = row["kind"]!.GetValue<string>() switch
            {
                "trace" => TraceQuery(events, input),
                "chain" => Outcome(() => Trace.Chain(events, input["start"]!.GetValue<string>())),
                var kind => throw new InvalidDataException($"{name}: unknown row kind {kind}"),
            };
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == CanonicalJson.Serialize(actual),
                $"{name}: the result differs from TypeScript's");
        }
    }

    // The trace of a query: an event's chain, or a field's, over the deltas the row gives.
    private static JsonNode TraceQuery(List<WorldEvent> events, JsonNode input)
    {
        var deltas = input["deltas"]!.AsArray().Select(item => WorldJson.Read<Delta>(item!.ToJsonString())).ToList();
        var query = input["query"]!;
        return Outcome(() => query["event_id"] is { } eventId
            ? Trace.TraceEvent(events, eventId.GetValue<string>())
            : Trace.TraceField(events, deltas, query["entity"]!.GetValue<string>(), query["field"]!.GetValue<string>()));
    }

    // The outcome of a trace as the golden writes it: the chain's events under "ok", or the refusal's code and message.
    private static JsonNode Outcome(Func<List<WorldEvent>> trace)
    {
        try
        {
            var chain = trace();
            return new JsonObject
            {
                ["status"] = "ok",
                ["events"] = JsonNode.Parse(WorldJson.Write(chain))!,
            };
        }
        catch (WorldError error)
        {
            return new JsonObject
            {
                ["status"] = "error",
                ["code"] = WorldJson.Name(error.Code),
                ["message"] = error.Message,
            };
        }
    }
}
