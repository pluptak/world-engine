using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// A memory world (src/api.ts `memoryWorld`) driven through the same sequence of calls the TypeScript golden made
// (Fixtures/memory-golden.expected.json, from scratchpad/gen/memory-golden.mjs). Every step's answer is compared, so the state a
// call leaves behind is checked by the calls after it. The world's template hash is the one the golden's snapshot carries: the
// resolved-set hash itself is checked by TemplateHashTests against TypeScript's.
public class MemoryGoldenTests
{
    [Fact]
    public void Memory_world_steps_match_TypeScript() => Replay("memory-golden.expected.json");

    [Fact]
    public void Memory_world_rounds_match_TypeScript() => Replay("memory-rounds-golden.expected.json");

    private static void Replay(string fixture)
    {
        var rows = GoldenRows.ReadRows(fixture);
        var start = WorldJson.Read<Snapshot>(rows[0]!["args"]!["snapshot"]!.ToJsonString());
        var world = new MemoryWorld(start, TestTemplates.RepoRegistry, start.TemplatesHash);

        foreach (var step in rows.Skip(1))
        {
            var name = step!["name"]!.GetValue<string>();
            var args = step["args"]!;
            var actual = Outcome(() => Step(world, step["op"]!.GetValue<string>(), args));
            Assert.True(
                CanonicalJson.Serialize(step["result"]) == CanonicalJson.Serialize(actual),
                $"{name}: expected {step["result"]?.ToJsonString()}, got {actual?.ToJsonString()}");
        }
    }

    // The answer to one call, in the shape the golden writes it.
    private static JsonNode? Step(MemoryWorld world, string op, JsonNode args) => op switch
    {
        "snapshot" => Json(world.CurrentSnapshot()),
        "options" => Json(world.OptionsFor(args["actor"]!.GetValue<string>(), args["refused"]?.GetValue<bool>() ?? false)),
        "check" => Verdict(world.Check(Read<Command>(args["command"]!))),
        "command" => Shape(world.Apply(
            Read<Command>(args["command"]!),
            args["basedOn"]?.GetValue<long>(),
            args["observe"]?.GetValue<bool>() ?? false)),
        "edit" => Shape(world.Edit(args["edit"]!.AsObject(), args["command_id"]?.GetValue<string>())),
        "beat" => new JsonArray([.. world.Beat([.. args["commands"]!.AsArray().Select(command => Read<Command>(command!))]).Select(result => (JsonNode?)Shape(result))]),
        "observe" => world.Observe(
            args["observer"]!.GetValue<string>(),
            args["since"]?.GetValue<long>(),
            args["since_tick"]?.GetValue<long>()),
        "inspect" => Projection.InspectEntity(world.CurrentSnapshot(), TestTemplates.RepoRegistry, [], args["observer"]!.GetValue<string>(), args["entity"]!.GetValue<string>()),
        "since" => Since(world, args["version"]!.GetValue<long>()),
        "attempts" => Json(world.Attempts(args["version"]!.GetValue<long>())),
        "query" => Query(world, args),
        "schedule" => Json(world.Scheduled()),
        "entity" => Json(world.EntityOf(args["id"]!.GetValue<string>())),
        "trace" => Trace(world, args),
        "catalog" => Json(world.CatalogEntries()),
        "fork" => Json(world.Fork().CurrentSnapshot()),
        "round" => RoundNode(world.TakeRound(Commands(args["moves"]!))),
        "round_as" => RoundNode(world.TakeRoundAs(Commands(args["moves"]!))),
        "pending" => PendingNode(world, args),
        "heard" => JsonValue.Create(world.Heard(
            Read<Snapshot>(args["before"]!),
            Read<Snapshot>(args["after"]!),
            Read<List<WorldEvent>>(args["events"]!),
            [.. args["observers"]!.AsArray().Select(observer => observer!.GetValue<string>())])),
        "verify" => Void(world.Verify),
        _ => throw new InvalidDataException($"unknown step {op}"),
    };

    // A round as the golden writes it: its status, number when it was taken, every move's result, and the close.
    private static JsonNode RoundNode(Round.Outcome outcome)
    {
        var shape = new JsonObject { ["status"] = outcome.Status.ToString().ToLowerInvariant() };
        if (outcome.ReasonCode is not null)
        {
            shape["reason_code"] = outcome.ReasonCode;
        }
        if (outcome.Number is not null)
        {
            shape["round"] = JsonValue.Create(outcome.Number.Value);
        }
        shape["results"] = new JsonArray([.. outcome.Results.Select(result => (JsonNode?)Shape(result))]);
        if (outcome.Closing is not null)
        {
            shape["closing"] = Shape(outcome.Closing);
        }
        return shape;
    }

    // The pending store after one call: the body's moves, and the handles and idle marks held.
    private static JsonNode PendingNode(MemoryWorld world, JsonNode args)
    {
        var store = world.Pending;
        var handle = args["handle"]!.GetValue<string>();
        switch (args["action"]!.GetValue<string>())
        {
            case "set":
                store.Set(handle, Read<Command>(args["command"]!));
                break;
            case "idle":
                store.SetIdle(handle);
                break;
            case "clear":
                store.Clear(handle, args["body"]?.GetValue<string>());
                break;
        }
        return new JsonObject
        {
            ["moves"] = Json(store.Moves(handle)),
            ["handles"] = Json(store.Handles()),
            ["idlers"] = Json(store.Idlers()),
        };
    }

    private static List<Command> Commands(JsonNode moves) => [.. moves.AsArray().Select(move => Read<Command>(move!))];

    private static JsonNode? Void(Action call)
    {
        call();
        return null;
    }

    private static JsonNode Since(MemoryWorld world, long version)
    {
        var (deltas, events) = world.Since(version);
        return new JsonObject { ["deltas"] = Json(deltas), ["events"] = Json(events) };
    }

    private static JsonNode Query(MemoryWorld world, JsonNode args)
    {
        var answer = args["kind"]!.GetValue<string>() == "fact"
            ? world.QueryFact(args["subject"]!.GetValue<string>(), args["relation"]!.GetValue<string>(), args["object"]?.GetValue<string>())
            : world.QueryPerceive(
                args["observer"]!.GetValue<string>(),
                args["sense"]!.GetValue<string>(),
                args["event_id"]?.GetValue<string>(),
                args["entity"]?.GetValue<string>());
        return new JsonObject { ["value"] = answer.Value, ["basis_code"] = answer.BasisCode };
    }

    private static JsonNode Trace(MemoryWorld world, JsonNode args) =>
        new JsonObject
        {
            ["events"] = Json(world.TraceOf(
                args["event_id"]?.GetValue<string>(),
                args["entity"]?.GetValue<string>(),
                args["field"]?.GetValue<string>())),
        };

    // A result as the golden writes it: every field a result has, with the ones it does not have left out.
    internal static JsonNode Shape(Pipeline.Result result)
    {
        var shape = new JsonObject
        {
            ["status"] = result.Status.ToString().ToLowerInvariant(),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
        };
        if (result.Candidates is not null)
        {
            shape["candidates"] = Json(result.Candidates);
        }
        if (result.ReasonCode is not null)
        {
            shape["reason_code"] = result.ReasonCode;
        }
        if (result.ReasonData is not null)
        {
            shape["reason_data"] = Json(result.ReasonData);
        }
        shape["snapshot"] = Json(result.Snapshot);
        shape["deltas"] = Json(result.Deltas);
        shape["events"] = Json(result.Events);
        if (result.Observation is not null)
        {
            shape["observation"] = result.Observation.DeepClone();
        }
        return shape;
    }

    // What a dry run says a command would get: the verdict fields only.
    private static JsonNode Verdict(Pipeline.Result result)
    {
        var verdict = new JsonObject
        {
            ["status"] = result.Status.ToString().ToLowerInvariant(),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
        };
        if (result.Candidates is not null)
        {
            verdict["candidates"] = Json(result.Candidates);
        }
        if (result.ReasonCode is not null)
        {
            verdict["reason_code"] = result.ReasonCode;
        }
        if (result.ReasonData is not null)
        {
            verdict["reason_data"] = Json(result.ReasonData);
        }
        return verdict;
    }

    private static T Read<T>(JsonNode node) => WorldJson.Read<T>(node.ToJsonString());

    private static JsonNode? Json<T>(T value) => JsonNode.Parse(WorldJson.Write(value));

    private static JsonNode? Outcome(Func<JsonNode?> call)
    {
        try
        {
            return call();
        }
        catch (WorldError error)
        {
            return new JsonObject { ["status"] = "error", ["code"] = error.Code, ["message"] = error.Message };
        }
    }

}
