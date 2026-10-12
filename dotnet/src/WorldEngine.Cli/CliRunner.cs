using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Json;
using WorldEngine.Store;

namespace WorldEngine.Cli;

// What one run of the CLI answers: the text it writes to stdout, and its exit status.
public sealed record CliOutput(string Stdout, int Status);

// The JSON adapter over a world (src/cli/main.ts `runCli`): one request in, one canonical answer out, status 0 for an answer and 2 for an
// invalid request. This slice answers the read ops over a stored world (snapshot, since, attempts, verify), as the TypeScript CLI does.
// The other ops, the contract's own check of each request and response, and `init` are the rest of the block.
public static class CliRunner
{
    public static CliOutput Run(IReadOnlyList<string> args, string input)
    {
        try
        {
            if (args.Count > 0)
            {
                return Invalid("not_ported");
            }
            JsonObject request;
            try
            {
                request = JsonNode.Parse(input) as JsonObject ?? throw new JsonException("The request is not an object");
            }
            catch (JsonException)
            {
                return Invalid("invalid_json");
            }
            var answer = Dispatch(request);
            // An answer whose own status is invalid exits 2, whichever op gave it, as the TypeScript CLI does.
            return new CliOutput(Line(answer), answer["status"] is { } status && JsonReads.Text(status) == "invalid" ? 2 : 0);
        }
        catch (WorldError error)
        {
            return Invalid(error.Code);
        }
    }

    private static JsonNode Dispatch(JsonObject request)
    {
        var op = JsonReads.Text(request["op"]);
        var world = JsonReads.Text(request["world"]);
        switch (op)
        {
            case "snapshot":
                return Node(StoreWorld.Open(Required(world)).CurrentSnapshot());
            case "since":
            {
                var (deltas, events) = StoreWorld.Open(Required(world)).Since(Version(request));
                return new JsonObject { ["deltas"] = Node(deltas), ["events"] = Node(events) };
            }
            case "attempts":
                return new JsonObject { ["attempts"] = Node(StoreWorld.Open(Required(world)).Attempts(Version(request))) };
            case "verify":
                return Verified(Required(world));
            case "command":
                return Answer(
                    StoreWorld.Open(Required(world)).Apply(CommandOf(request), JsonReads.SafeInt(request["based_on_version"]), Flag(request["observe"])),
                    Flag(request["include_snapshot"]));
            case "edit":
                return Answer(
                    StoreWorld.Open(Required(world)).Edit(
                        request["edit"] as JsonObject ?? throw new WorldError("invalid_edit", "The request names no edit"),
                        JsonReads.Text(request["command_id"]),
                        Flag(request["perceivers"]),
                        null,
                        JsonReads.SafeInt(request["based_on_version"])),
                    Flag(request["include_snapshot"]));
            case "beat":
            {
                var results = StoreWorld.Open(Required(world)).Beat(Commands(request["commands"]), JsonReads.SafeInt(request["based_on_version"]));
                var includeSnapshot = Flag(request["include_snapshot"]);
                return new JsonObject { ["results"] = new JsonArray(results.Select(result => (JsonNode?)Answer(result, includeSnapshot)).ToArray()) };
            }
            case "round":
                return Round(StoreWorld.Open(Required(world)).TakeRound(Commands(request["moves"])));
            case "check":
                return Verdict(StoreWorld.Open(Required(world)).Check(CommandOf(request)));
            case "options":
                return Node(StoreWorld.Open(Required(world)).OptionsFor(Text(request, "actor"), request["refused"] is { } refused && refused.GetValue<bool>()));
            case "inspect":
                return new JsonObject { ["inspection"] = StoreWorld.Open(Required(world)).Inspect(Text(request, "observer"), Text(request, "entity")) };
            case "observe":
                return StoreWorld.Open(Required(world)).Observe(Text(request, "observer"), JsonReads.SafeInt(request["since"]), JsonReads.SafeInt(request["since_tick"]));
            case "schedule":
                return new JsonObject { ["schedule"] = Node(StoreWorld.Open(Required(world)).Scheduled()) };
            case "query":
                return Query(StoreWorld.Open(Required(world)), request["query"] as JsonObject ?? throw new WorldError("invalid_query", "The request names no query"));
            case "trace":
                return Trace(StoreWorld.Open(Required(world)), request["query"] as JsonObject ?? throw new WorldError("invalid_query", "The request names no query"));
            case "catalog":
                return new JsonObject { ["catalog"] = Node(StoreWorld.Open(Required(world)).CatalogEntries()) };
            case "actor_observe":
                return ActorOf(StoreWorld.Open(Required(world)), request).Observe(JsonReads.SafeInt(request["since_tick"]));
            case "actor_inspect":
                return new JsonObject { ["inspection"] = ActorOf(StoreWorld.Open(Required(world)), request).Inspect(Text(request, "entity")) };
            case "actor_options":
                return ActorOf(StoreWorld.Open(Required(world)), request).OptionsOf(Flag(request["refused"]));
            case "actor_check":
                return ActorOf(StoreWorld.Open(Required(world)), request).Check(ActorCommandOf(request));
            case "actor_command":
                return ActorOf(StoreWorld.Open(Required(world)), request).Apply(ActorCommandOf(request));
            case "player_observe":
                return PlayerOf(StoreWorld.Open(Required(world)), request).Observe(JsonReads.SafeInt(request["since_tick"]));
            case "player_inspect":
                return new JsonObject { ["inspection"] = PlayerOf(StoreWorld.Open(Required(world)), request).Inspect(Text(request, "entity")) };
            case "player_options":
                return PlayerOf(StoreWorld.Open(Required(world)), request).Options(JsonReads.Text(request["body"]), Flag(request["refused"]));
            case "player_check":
                return PlayerOf(StoreWorld.Open(Required(world)), request).Check(MoveOf(request), MoveBody(request));
            case "player_submit":
                return PlayerOf(StoreWorld.Open(Required(world)), request).Submit(MoveOf(request), MoveBody(request));
            case "player_withdraw":
                return PlayerOf(StoreWorld.Open(Required(world)), request).Withdraw(JsonReads.Text(request["body"]));
            case "player_pending":
                return new JsonObject { ["moves"] = PlayerOf(StoreWorld.Open(Required(world)), request).Pending() };
            case "director_submitted":
                return new JsonObject { ["handles"] = Node(new DirectorWorld(StoreWorld.Open(Required(world))).Submitted()) };
            case "director_close_round":
                return Round(new DirectorWorld(StoreWorld.Open(Required(world))).CloseRound());
            case "director_edit":
                return Answer(
                    new DirectorWorld(StoreWorld.Open(Required(world))).Edit(
                        request["edit"] as JsonObject ?? throw new WorldError("invalid_edit", "The request names no edit"),
                        JsonReads.Text(request["command_id"]),
                        Flag(request["perceivers"])),
                    Flag(request["include_snapshot"]));
            default:
                throw new WorldError("invalid_op", $"Unknown op {op}");
        }
    }

    // The files as they are, judged by the log's replay (`verifyWorld`): the answer names the first place they differ.
    private static JsonObject Verified(string dir)
    {
        var verification = WorldVerify.Verify(dir, WorldFiles.ReadTemplates(dir));
        if (verification.Ok)
        {
            return new JsonObject { ["ok"] = true, ["entries"] = verification.Entries, ["version"] = verification.Version };
        }
        var divergence = verification.Divergence!;
        return new JsonObject
        {
            ["ok"] = false,
            ["divergence"] = new JsonObject { ["file"] = divergence.File, ["line"] = divergence.Line, ["code"] = divergence.Code },
        };
    }

    private static JsonObject Verdict(Pipeline.Result result)
    {
        var verdict = new JsonObject
        {
            ["status"] = Node(result.Status),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
        };
        if (result.Candidates is { } candidates)
        {
            verdict["candidates"] = Node(candidates);
        }
        if (result.ReasonCode is { } reason)
        {
            verdict["reason_code"] = reason;
        }
        if (result.ReasonData is { } data)
        {
            verdict["reason_data"] = Node(data);
        }
        return verdict;
    }

    // One write's answer (`commandResponse`): its verdict, the version after it, its deltas and events, and the snapshot or the actor's
    // observation when asked for. A spawn's delta is followed by one delta for each relation field the new entity came with.
    private static JsonObject Answer(Pipeline.Result result, bool includeSnapshot)
    {
        var answer = Verdict(result);
        answer["snapshot_version"] = result.Snapshot.Version;
        answer["deltas"] = ResponseDeltas(result.Deltas);
        answer["events"] = Node(result.Events);
        if (includeSnapshot)
        {
            answer["snapshot"] = Node(result.Snapshot);
        }
        if (result.Observation is { } observation)
        {
            answer["observation"] = observation.DeepClone();
        }
        return answer;
    }

    private static JsonArray ResponseDeltas(IReadOnlyList<Delta> deltas)
    {
        var response = new JsonArray();
        foreach (var delta in deltas)
        {
            response.Add(Node(delta));
            if (delta.Field == "entity" && delta.To is JsonObject entity)
            {
                foreach (var field in new[] { "support", "contained_in", "location", "detached_from", "pos" })
                {
                    if (entity.ContainsKey(field))
                    {
                        response.Add(new JsonObject
                        {
                            ["event_id"] = delta.EventId,
                            ["entity"] = delta.Entity,
                            ["field"] = field,
                            ["from"] = null,
                            ["to"] = entity[field]?.DeepClone(),
                        });
                    }
                }
            }
        }
        return response;
    }

    // A round's answer (`roundResponse`): its status, its reason when refused, its number when taken, each move's answer, and the close.
    private static JsonObject Round(Round.Outcome outcome)
    {
        var answer = new JsonObject { ["status"] = Node(outcome.Status) };
        if (outcome.ReasonCode is { } reason)
        {
            answer["reason_code"] = reason;
        }
        if (outcome.Number is { } number)
        {
            answer["round"] = number;
        }
        answer["results"] = new JsonArray(outcome.Results.Select(result => (JsonNode?)Answer(result, false)).ToArray());
        if (outcome.Closing is { } closing)
        {
            answer["closing"] = Answer(closing, false);
        }
        return answer;
    }

    private static List<Command> Commands(JsonNode? node) =>
        (node as JsonArray ?? throw new WorldError("invalid_request", "The request names no commands"))
            .Select(item => WorldJson.Read<Command>(item!.ToJsonString()))
            .ToList();

    private static bool Flag(JsonNode? node) => node is JsonValue value && value.TryGetValue(out bool flag) && flag;

    private static JsonObject Query(StoreWorld world, JsonObject query) => Text(query, "kind") switch
    {
        "fact" => Answer(world.QueryFact(Text(query, "subject"), Text(query, "relation"), JsonReads.Text(query["object"]))),
        "perceive" => Answer(world.QueryPerceive(
            Text(query, "observer"),
            Text(query, "sense"),
            JsonReads.Text(query["event_id"]),
            JsonReads.Text(query["entity"]))),
        var kind => throw new WorldError("invalid_query", $"Unknown query {kind}"),
    };

    private static JsonObject Answer(Perception.Answer answer) => new() { ["value"] = answer.Value, ["basis_code"] = answer.BasisCode };

    private static JsonObject Trace(StoreWorld world, JsonObject query) =>
        new() { ["events"] = Node(world.TraceOf(JsonReads.Text(query["event_id"]), JsonReads.Text(query["entity"]), JsonReads.Text(query["field"]))) };

    private static Command CommandOf(JsonObject request) =>
        WorldJson.Read<Command>((request["command"] ?? throw new WorldError("invalid_command", "The request names no command")).ToJsonString());

    // A controller's command as an actor sends it: its id, verb, target and args, never an actor or `perceivers` (`ActorCommand`).
    private static ActorCommand ActorCommandOf(JsonObject request) =>
        ActorCommandFrom(request["command"] as JsonObject ?? throw new WorldError("invalid_command", "The request names no command"));

    // A player's move: a command the view writes, with the body it is for when the slot holds several (`PlayerMove`).
    private static ActorCommand MoveOf(JsonObject request) =>
        ActorCommandFrom(request["move"] as JsonObject ?? throw new WorldError("invalid_move", "The request names no move"));

    private static string? MoveBody(JsonObject request) => JsonReads.Text((request["move"] as JsonObject)?["body"]);

    private static ActorCommand ActorCommandFrom(JsonObject command)
    {
        return new ActorCommand(
            Text(command, "command_id"),
            Text(command, "verb"),
            JsonReads.Text(command["target"]),
            command["args"] is JsonObject args ? args.ToDictionary(pair => pair.Key, pair => pair.Value?.DeepClone(), StringComparer.Ordinal) : null);
    }

    // The view of the body the request names, as `actorWorld` builds it over the world.
    private static ActorWorld ActorOf(StoreWorld world, JsonObject request) => new(world, Text(request, "actor"));

    // The handle of a player, over the world, as `playerWorld` builds it for the handle the request names.
    private static PlayerWorld PlayerOf(StoreWorld world, JsonObject request) => new(world, Text(request, "handle"));

    private static string Text(JsonObject request, string name) =>
        JsonReads.Text(request[name]) ?? throw new WorldError("invalid_request", $"The request names no {name}");

    private static string Required(string? world) => world ?? throw new WorldError("invalid_world", "The request names no world");

    private static long Version(JsonObject request) =>
        JsonReads.SafeInt(request["version"]) ?? throw new WorldError("invalid_version", "The request names no version");

    private static JsonNode? Node<T>(T value) => JsonNode.Parse(WorldJson.Write(value));

    private static string Line(JsonNode? answer) => CanonicalJson.Serialize(answer) + "\n";

    // A refused request: the status and the one issue its code names, as `invalidFromIssues` writes it.
    private static CliOutput Invalid(string code)
    {
        var failure = new JsonObject
        {
            ["status"] = "invalid",
            ["issues"] = new JsonArray(new JsonObject { ["code"] = code, ["message"] = code, ["path"] = new JsonArray() }),
        };
        return new CliOutput(Line(failure), 2);
    }
}
