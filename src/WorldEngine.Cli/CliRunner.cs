using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Contract;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Cli;

// What one run of the CLI answers: the text it writes to stdout, and its exit status.
public sealed record CliOutput(string Stdout, int Status);

// The JSON adapter over a world: one request in, one answer out, status 0 for an answer and 2 for an invalid request. A request is
// checked against the shape of its op (`Checks`) before anything runs; `init` builds a world from a scenario file.
public static class CliRunner
{
    public static CliOutput Run(IReadOnlyList<string> args, string input)
    {
        try
        {
            // `init` takes its arguments, and anything else reads its request from input, the arguments ignored (src/cli/main.ts `runCli`).
            if (args.Count > 0 && args[0] == "init")
            {
                return Init(args);
            }
            JsonNode? parsed;
            try
            {
                parsed = JsonNode.Parse(input);
            }
            catch (JsonException)
            {
                return Invalid(Code.InvalidJson);
            }
            // A request the contract refuses is answered as invalid, and nothing is run for it (`RequestSchema`).
            if (parsed is not JsonObject request || !Checks.IsRequest(ValueOf(request)))
            {
                return Invalid(Code.InvalidRequest);
            }
            var answer = Dispatch(request);
            // An answer whose own status is invalid exits 2, whichever op gave it, as the TypeScript CLI does.
            return new CliOutput(Line(answer), answer["status"] is { } status && JsonReads.Text(status) == "invalid" ? 2 : 0);
        }
        catch (WorldError error)
        {
            return Invalid(error);
        }
        catch (Exception)
        {
            // Anything else is the engine's own fault, which the TypeScript CLI answers the same way (`errorIssues`).
            return Invalid(Code.InternalError);
        }
    }

    // `init <dir> <scenario> [coverage]` (src/cli/main.ts `initializeWorld`): a world made from a scenario file, answered with its version.
    // Each way the files can be wrong gets its own code, as TypeScript's do.
    private static CliOutput Init(IReadOnlyList<string> args)
    {
        if (args.Count != 3 && args.Count != 4)
        {
            return Invalid(Code.InvalidInitArgs);
        }
        var scenarioText = ReadFile(args[2]);
        if (scenarioText is null)
        {
            return Invalid(Code.NoSuchScenario);
        }
        if (!TryParse(scenarioText, out var scenario))
        {
            return Invalid(Code.InvalidScenarioJson);
        }
        if (!Checks.IsScenario(ValueOf(scenario)))
        {
            return Invalid(Code.InvalidScenario);
        }
        Coverage? coverage = null;
        if (args.Count == 4)
        {
            var coverageText = ReadFile(args[3]);
            if (coverageText is null)
            {
                return Invalid(Code.NoSuchCoverage);
            }
            if (!TryParse(coverageText, out var coverageJson))
            {
                return Invalid(Code.InvalidCoverageJson);
            }
            if (!Checks.IsCoverage(ValueOf(coverageJson)))
            {
                return Invalid(Code.InvalidCoverage);
            }
            coverage = WorldJson.Read<Coverage>(coverageJson!);
        }
        var registry = ShippedTemplates;
        var made = WorldBuilder.Snapshot(ValueOf(scenario)!, registry, coverage);
        WorldBuilder.Create(args[1], made.Snapshot, registry, made.Ids);
        return new CliOutput(
            Line(new JsonObject { ["status"] = "ok", ["world"] = args[1], ["snapshot_version"] = made.Snapshot.Version }),
            0);
    }

    // A file's text as the file holds it (a byte order mark is kept, as TypeScript keeps it), or null when it cannot be read.
    private static string? ReadFile(string path)
    {
        try
        {
            return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetString(File.ReadAllBytes(path));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    // Whether the text is JSON at all; the value it holds may be null, which is still a parse.
    private static bool TryParse(string text, out JsonNode? value)
    {
        try
        {
            value = JsonNode.Parse(text);
            return true;
        }
        catch (JsonException)
        {
            value = null;
            return false;
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
                        EditOf(request),
                        JsonReads.Text(request["command_id"]),
                        Flag(request["perceivers"]),
                        null,
                        JsonReads.SafeInt(request["based_on_version"])),
                    Flag(request["include_snapshot"]));
            case "beat":
                {
                    var results = StoreWorld.Open(Required(world)).Beat(Commands(request["commands"]), JsonReads.SafeInt(request["based_on_version"]));
                    var includeSnapshot = Flag(request["include_snapshot"]);
                    return new JsonObject { ["results"] = new JsonArray([.. results.Select(result => (JsonNode?)Answer(result, includeSnapshot))]) };
                }
            case "round":
                return Round(StoreWorld.Open(Required(world)).TakeRound(Commands(request["moves"])));
            case "check":
                return Verdict(StoreWorld.Open(Required(world)).Check(CommandOf(request)));
            case "options":
                return Node(StoreWorld.Open(Required(world)).OptionsFor(Text(request, "actor"), request["refused"] is { } refused && refused.GetValue<bool>()))!;
            case "inspect":
                return new JsonObject { ["inspection"] = Node(StoreWorld.Open(Required(world)).Inspect(Text(request, "observer"), Text(request, "entity"))) };
            case "observe":
                return Node(StoreWorld.Open(Required(world)).Observe(Text(request, "observer"), JsonReads.SafeInt(request["since"]), JsonReads.SafeInt(request["since_tick"])))!;
            case "schedule":
                {
                    var filter = request["filter"] as JsonObject ?? new JsonObject();
                    return new JsonObject
                    {
                        ["schedule"] = Node(StoreWorld.Open(Required(world)).Scheduled(
                            JsonReads.Text(filter["kind"]),
                            JsonReads.Text(filter["entity"]),
                            JsonReads.SafeInt(filter["until_tick"]))),
                    };
                }
            case "query":
                return Query(StoreWorld.Open(Required(world)), request["query"] as JsonObject ?? throw new WorldError(Code.InvalidQuery, "The request names no query"));
            case "trace":
                return Trace(StoreWorld.Open(Required(world)), request["query"] as JsonObject ?? throw new WorldError(Code.InvalidQuery, "The request names no query"));
            case "catalog":
                return new JsonObject
                {
                    ["catalog"] = Node(world is null ? Catalog.Of(ShippedTemplates) : StoreWorld.Open(world).CatalogEntries()),
                };
            // A run played again: the new world at `to` is made from `world`'s initial snapshot and set, and answered with its version.
            case "restart":
                {
                    var to = Text(request, "to");
                    WorldBuilder.Restart(Required(world), to);
                    return new JsonObject { ["snapshot_version"] = StoreWorld.Open(to).CurrentSnapshot().Version };
                }
            case "verbs":
                return new JsonObject { ["verbs"] = Node(VerbRegistry.Catalog()) };
            case "capabilities":
                return CapabilitiesOf();
            case "actor_observe":
                return Node(ActorOf(StoreWorld.Open(Required(world)), request).Observe(JsonReads.SafeInt(request["since_tick"])))!;
            case "actor_inspect":
                return new JsonObject { ["inspection"] = Node(ActorOf(StoreWorld.Open(Required(world)), request).Inspect(Text(request, "entity"))) };
            case "actor_options":
                return Node(ActorOf(StoreWorld.Open(Required(world)), request).OptionsOf(Flag(request["refused"])))!;
            case "actor_check":
                return Node(ActorOf(StoreWorld.Open(Required(world)), request).Check(ActorCommandOf(request)))!;
            case "actor_command":
                return Node(ActorOf(StoreWorld.Open(Required(world)), request).Apply(ActorCommandOf(request)))!;
            case "player_observe":
                return Node(PlayerOf(StoreWorld.Open(Required(world)), request).Observe(JsonReads.SafeInt(request["since_tick"])))!;
            case "player_inspect":
                return new JsonObject { ["inspection"] = Node(PlayerOf(StoreWorld.Open(Required(world)), request).Inspect(Text(request, "entity"))) };
            case "player_options":
                return Node(PlayerOf(StoreWorld.Open(Required(world)), request).Options(JsonReads.Text(request["body"]), Flag(request["refused"])))!;
            case "player_check":
                return Node(PlayerOf(StoreWorld.Open(Required(world)), request).Check(MoveOf(request), MoveBody(request)))!;
            case "player_submit":
                return Node(PlayerOf(StoreWorld.Open(Required(world)), request).Submit(MoveOf(request), MoveBody(request)))!;
            case "player_withdraw":
                return Node(PlayerOf(StoreWorld.Open(Required(world)), request).Withdraw(JsonReads.Text(request["body"])))!;
            case "player_pending":
                return new JsonObject { ["moves"] = Node(PlayerOf(StoreWorld.Open(Required(world)), request).Pending()) };
            case "director_submitted":
                return new JsonObject { ["handles"] = Node(new DirectorWorld(StoreWorld.Open(Required(world))).Submitted()) };
            case "director_close_round":
                return Round(new DirectorWorld(StoreWorld.Open(Required(world))).CloseRound());
            case "director_edit":
                return Answer(
                    new DirectorWorld(StoreWorld.Open(Required(world))).Edit(
                        EditOf(request),
                        JsonReads.Text(request["command_id"]),
                        Flag(request["perceivers"])),
                    Flag(request["include_snapshot"]));
            default:
                throw new WorldError(Code.InvalidOp, $"Unknown op {op}");
        }
    }

    // The shipped template set (templates/, copied beside the command line): what a world made without one is built from.
    private static IReadOnlyDictionary<string, Template> ShippedTemplates =>
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    // The engine's capabilities (src/engine/capabilities.ts `ENGINE_CAPABILITIES`).
    private static JsonObject CapabilitiesOf() => new()
    {
        ["relations"] = Names(Capabilities.Relations),
        ["senses"] = Names(Capabilities.Senses),
        ["computed_properties"] = Names(Capabilities.ComputedProperties),
    };

    private static JsonArray Names(IEnumerable<string> names) => new([.. names.Select(name => (JsonNode?)JsonValue.Create(name))]);

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
            verdict["reason_code"] = WorldJson.Name(reason);
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
            answer["observation"] = Node(observation);
        }
        return answer;
    }

    private static JsonArray ResponseDeltas(IReadOnlyList<Delta> deltas)
    {
        var response = new JsonArray();
        foreach (var delta in deltas)
        {
            response.Add(Node(delta));
            if (delta.Field == "entity" && delta.To is Value.Map entity)
            {
                // A field the new entity leaves empty has no delta: it was nothing and is nothing.
                foreach (var field in new[] { "support", "contained_in", "location", "detached_from", "pos" })
                {
                    if (entity.GetValueOrDefault(field) is { } value)
                    {
                        response.Add(new JsonObject
                        {
                            ["event_id"] = delta.EventId,
                            ["entity"] = delta.Entity,
                            ["field"] = field,
                            ["from"] = null,
                            ["to"] = ValueJson.ToNode(value),
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
            answer["reason_code"] = WorldJson.Name(reason);
        }
        if (outcome.Number is { } number)
        {
            answer["round"] = number;
        }
        answer["results"] = new JsonArray([.. outcome.Results.Select(result => (JsonNode?)Answer(result, false))]);
        if (outcome.Closing is { } closing)
        {
            answer["closing"] = Answer(closing, false);
        }
        return answer;
    }

    private static List<Command> Commands(JsonNode? node) =>
        [.. (node as JsonArray ?? throw new WorldError(Code.InvalidRequest, "The request names no commands")).Select(item => WorldJson.Read<Command>(item!))];

    private static bool Flag(JsonNode? node) => node is JsonValue value && value.TryGetValue(out bool flag) && flag;

    private static JsonObject Query(StoreWorld world, JsonObject query) => Text(query, "kind") switch
    {
        "fact" => Answer(world.QueryFact(Text(query, "subject"), Text(query, "relation"), JsonReads.Text(query["object"]))),
        "perceive" => Answer(world.QueryPerceive(
            Text(query, "observer"),
            Text(query, "sense"),
            JsonReads.Text(query["event_id"]),
            JsonReads.Text(query["entity"]))),
        var kind => throw new WorldError(Code.InvalidQuery, $"Unknown query {kind}"),
    };

    private static JsonObject Answer(Perception.Answer answer) => new() { ["value"] = WorldJson.Name(answer.Value), ["basis_code"] = WorldJson.Name(answer.BasisCode) };

    private static JsonObject Trace(StoreWorld world, JsonObject query) =>
        new() { ["events"] = Node(world.TraceOf(JsonReads.Text(query["event_id"]), JsonReads.Text(query["entity"]), JsonReads.Text(query["field"]))) };

    private static Command CommandOf(JsonObject request) =>
        WorldJson.Read<Command>(request["command"] ?? throw new WorldError(Code.InvalidCommand, "The request names no command"));

    // A controller's command as an actor sends it: its id, verb, target and args, never an actor or `perceivers` (`ActorCommand`).
    private static ActorCommand ActorCommandOf(JsonObject request) =>
        ActorCommandFrom(request["command"] as JsonObject ?? throw new WorldError(Code.InvalidCommand, "The request names no command"));

    // A player's move: a command the view writes, with the body it is for when the slot holds several (`PlayerMove`).
    private static ActorCommand MoveOf(JsonObject request) =>
        ActorCommandFrom(request["move"] as JsonObject ?? throw new WorldError(Code.InvalidMove, "The request names no move"));

    private static string? MoveBody(JsonObject request) => JsonReads.Text((request["move"] as JsonObject)?["body"]);

    private static ActorCommand ActorCommandFrom(JsonObject command)
    {
        return new ActorCommand(
            Text(command, "command_id"),
            Text(command, "verb"),
            JsonReads.Text(command["target"]),
            ValueJson.FromNode(command["args"]) as Value.Map);
    }

    // The view of the body the request names, as `actorWorld` builds it over the world.
    // A file or request as the contract reads it: none when it cannot be a value (a fraction, or a null in a list).
    private static Value? ValueOf(JsonNode? node) => ValueJson.TryFromNode(node, out var value) ? value : null;

    // The request's edit as the engine reads it; the contract has checked it is one.
    private static Value.Map EditOf(JsonObject request) =>
        ValueJson.FromNode(request["edit"]) as Value.Map ?? throw new WorldError(Code.InvalidEdit, "The request names no edit");

    private static ActorWorld ActorOf(StoreWorld world, JsonObject request) => new(world, Text(request, "actor"));

    // The handle of a player, over the world, as `playerWorld` builds it for the handle the request names.
    private static PlayerWorld PlayerOf(StoreWorld world, JsonObject request) => new(world, Text(request, "handle"));

    private static string Text(JsonObject request, string name) =>
        JsonReads.Text(request[name]) ?? throw new WorldError(Code.InvalidRequest, $"The request names no {name}");

    private static string Required(string? world) => world ?? throw new WorldError(Code.InvalidWorld, "The request names no world");

    private static long Version(JsonObject request) =>
        JsonReads.SafeInt(request["version"]) ?? throw new WorldError(Code.InvalidVersion, "The request names no version");

    private static JsonNode? Node<T>(T value) => JsonNode.Parse(WorldJson.Write(value));

    private static string Line(JsonNode? answer) => CanonicalJson.Serialize(answer) + "\n";

    // A refused world call: its code, then each rule it broke, as `errorIssues` writes them.
    private static CliOutput Invalid(WorldError error)
    {
        var issues = new JsonArray(new JsonObject { ["code"] = WorldJson.Name(error.Code), ["message"] = WorldJson.Name(error.Code), ["path"] = new JsonArray() });
        foreach (var rule in error.Issues)
        {
            issues.Add(new JsonObject
            {
                ["code"] = WorldJson.Name(rule.Code),
                ["message"] = rule.Message,
                ["path"] = new JsonArray([.. rule.Path.Select(part => (JsonNode?)JsonValue.Create(part))]),
            });
        }
        return new CliOutput(Line(new JsonObject { ["status"] = "invalid", ["issues"] = issues }), 2);
    }

    // A refused request: the status and the one issue its code names, as `invalidFromIssues` writes it.
    private static CliOutput Invalid(Code code) => Invalid(new WorldError(code, WorldJson.Name(code)));
}
