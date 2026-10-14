using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The player and director handles (src/player-world.ts, src/director-world.ts) over a memory world with a running run of two players,
// driven through the calls the TypeScript golden made (Fixtures/handles-golden.expected.json, from scratchpad/gen/handles-golden.mjs).
// Each answer is compared, including the pending moves and rounds each call leaves behind.
public class HandlesGoldenTests
{
    [Fact]
    public void Handle_steps_match_TypeScript()
    {
        var rows = GoldenRows.ReadRows("handles-golden.expected.json");
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

    private static JsonNode? Step(MemoryWorld world, string op, JsonNode args)
    {
        var handle = args["handle"]?.GetValue<string>();
        return op switch
        {
            "snapshot" => Json(world.CurrentSnapshot()),
            "edit" => Shape(world.Edit(args["edit"]!.AsObject())),
            "observe" => new PlayerWorld(world, handle!).Observe(args["since_tick"]?.GetValue<long>()),
            "inspect" => new PlayerWorld(world, handle!).Inspect(args["entity"]!.GetValue<string>()),
            "options" => new PlayerWorld(world, handle!).Options(args["body"]?.GetValue<string>(), args["refused"]?.GetValue<bool>() ?? false),
            "check" => new PlayerWorld(world, handle!).Check(Read<ActorCommand>(args["command"]!)),
            "submit" => new PlayerWorld(world, handle!).Submit(Read<ActorCommand>(args["move"]!), args["body"]?.GetValue<string>()),
            "pending" => new PlayerWorld(world, handle!).Pending(),
            "withdraw" => new PlayerWorld(world, handle!).Withdraw(args["body"]?.GetValue<string>()),
            "idle" => new PlayerWorld(world, handle!).Idle(),
            "submitted" => Json(new DirectorWorld(world).Submitted()),
            "close_round" => RoundNode(new DirectorWorld(world).CloseRound()),
            "close_rounds" => new DirectorWorld(world).CloseRounds(
                args["max"]!.GetValue<int>(),
                args["stop_before"]?.GetValue<string>()),
            "attempts" => Json(world.Attempts(args["version"]!.GetValue<long>())),
            _ => throw new InvalidDataException($"unknown step {op}"),
        };
    }

    // A round as the golden writes it: its status, number when it was taken, every move's result, and the close.
    private static JsonNode RoundNode(Round.Outcome outcome)
    {
        var shape = new JsonObject { ["status"] = outcome.Status.ToString().ToLowerInvariant() };
        if (outcome.ReasonCode is not null)
        {
            shape["reason_code"] = WorldJson.Name(outcome.ReasonCode.Value);
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

    // A result as the golden writes it: every field a result has, with the ones it does not have left out.
    private static JsonNode Shape(Pipeline.Result result)
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
            shape["reason_code"] = WorldJson.Name(result.ReasonCode.Value);
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
            return new JsonObject { ["status"] = "error", ["code"] = WorldJson.Name(error.Code), ["message"] = error.Message };
        }
    }
}
