using System.Text;
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

// The adapter over a world: one request in, one answer out, status 0 for an answer and 2 for an invalid request. A request is read once
// as a value and checked against the shape of its op (`Checks`) before anything runs, and the answer is a value written once;
// `init` builds a world from a scenario file.
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
            if (!ValueJson.TryParse(input, out var parsed))
            {
                return Invalid(Code.InvalidJson);
            }
            // A request the contract refuses is answered as invalid, and nothing is run for it (`RequestSchema`).
            if (parsed is not Value.Map request || !Checks.IsRequest(request))
            {
                return Invalid(Code.InvalidRequest);
            }
            var answer = Dispatch(request);
            // An answer whose own status is invalid exits 2, whichever op gave it, as the TypeScript CLI does.
            var status = (answer as Value.Map)?.GetValueOrDefault("status").AsText();
            return new CliOutput(Line(answer), status == "invalid" ? 2 : 0);
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
        if (!ValueJson.TryParse(scenarioText, out var scenario))
        {
            return Invalid(Code.InvalidScenarioJson);
        }
        if (!Checks.IsScenario(scenario))
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
            if (!ValueJson.TryParse(coverageText, out var coverageValue))
            {
                return Invalid(Code.InvalidCoverageJson);
            }
            if (!Checks.IsCoverage(coverageValue))
            {
                return Invalid(Code.InvalidCoverage);
            }
            coverage = WorldJson.Read<Coverage>(coverageValue!);
        }
        var registry = ShippedTemplates;
        var made = WorldBuilder.Snapshot(scenario!, registry, coverage);
        WorldBuilder.Create(args[1], made.Snapshot, registry, made.Ids);
        return new CliOutput(Line(Obj(("status", "ok"), ("world", args[1]), ("snapshot_version", made.Snapshot.Version))), 0);
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

    private static Value? Dispatch(Value.Map request)
    {
        var op = request["op"].AsText();
        var world = request.GetValueOrDefault("world").AsText();
        switch (op)
        {
            case "snapshot":
                return Of(StoreWorld.Open(Required(world)).CurrentSnapshot());
            case "since":
                {
                    var (deltas, events) = StoreWorld.Open(Required(world)).Since(Version(request));
                    return Obj(("deltas", deltas), ("events", events));
                }
            case "attempts":
                return Obj(("attempts", StoreWorld.Open(Required(world)).Attempts(Version(request))));
            case "verify":
                return Verified(Required(world));
            case "command":
                return Answer(
                    StoreWorld.Open(Required(world)).Apply(CommandOf(request), Int(request, "based_on_version"), Flag(request, "observe")),
                    Flag(request, "include_snapshot"));
            case "edit":
                return Answer(
                    StoreWorld.Open(Required(world)).Edit(
                        EditOf(request),
                        Optional(request, "command_id"),
                        Flag(request, "perceivers"),
                        null,
                        Int(request, "based_on_version")),
                    Flag(request, "include_snapshot"));
            case "beat":
                {
                    var results = StoreWorld.Open(Required(world)).Beat(Commands(request, "commands"), Int(request, "based_on_version"));
                    var includeSnapshot = Flag(request, "include_snapshot");
                    return Obj(("results", Value.Of(results.Select(result => (Value)Answer(result, includeSnapshot)))));
                }
            case "round":
                return Round(StoreWorld.Open(Required(world)).TakeRound(Commands(request, "moves")));
            case "check":
                return Verdict(StoreWorld.Open(Required(world)).Check(CommandOf(request)));
            case "options":
                return Of(StoreWorld.Open(Required(world)).OptionsFor(Text(request, "actor"), Flag(request, "refused")));
            case "inspect":
                return Obj(("inspection", StoreWorld.Open(Required(world)).Inspect(Text(request, "observer"), Text(request, "entity"))));
            case "observe":
                return Of(StoreWorld.Open(Required(world)).Observe(Text(request, "observer"), Int(request, "since"), Int(request, "since_tick")));
            case "schedule":
                {
                    var filter = request.GetValueOrDefault("filter") as Value.Map ?? Value.Map.Empty;
                    return Obj(("schedule", StoreWorld.Open(Required(world)).Scheduled(
                        Optional(filter, "kind"),
                        Optional(filter, "entity"),
                        Int(filter, "until_tick"))));
                }
            case "query":
                return Query(StoreWorld.Open(Required(world)), QueryOf(request));
            case "trace":
                {
                    var query = QueryOf(request);
                    return Obj(("events", StoreWorld.Open(Required(world)).TraceOf(
                        Optional(query, "event_id"),
                        Optional(query, "entity"),
                        Optional(query, "field"))));
                }
            case "catalog":
                return Obj(("catalog", world is null ? Catalog.Of(ShippedTemplates) : StoreWorld.Open(world).CatalogEntries()));
            // A run played again: the new world at `to` is made from `world`'s initial snapshot and set, and answered with its version.
            case "restart":
                {
                    var to = Text(request, "to");
                    WorldBuilder.Restart(Required(world), to);
                    return Obj(("snapshot_version", StoreWorld.Open(to).CurrentSnapshot().Version));
                }
            case "verbs":
                return Obj(("verbs", VerbRegistry.Catalog()));
            case "capabilities":
                return Obj(
                    ("relations", Capabilities.Relations),
                    ("senses", Capabilities.Senses),
                    ("computed_properties", Capabilities.ComputedProperties));
            case "actor_observe":
                return Of(ActorOf(StoreWorld.Open(Required(world)), request).Observe(Int(request, "since_tick")));
            case "actor_inspect":
                return Obj(("inspection", ActorOf(StoreWorld.Open(Required(world)), request).Inspect(Text(request, "entity"))));
            case "actor_options":
                return Of(ActorOf(StoreWorld.Open(Required(world)), request).OptionsOf(Flag(request, "refused")));
            case "actor_check":
                return Of(ActorOf(StoreWorld.Open(Required(world)), request).Check(ActorCommandOf(request)));
            case "actor_command":
                return Of(ActorOf(StoreWorld.Open(Required(world)), request).Apply(ActorCommandOf(request)));
            case "player_observe":
                return Of(PlayerOf(StoreWorld.Open(Required(world)), request).Observe(Int(request, "since_tick")));
            case "player_inspect":
                return Obj(("inspection", PlayerOf(StoreWorld.Open(Required(world)), request).Inspect(Text(request, "entity"))));
            case "player_options":
                return Of(PlayerOf(StoreWorld.Open(Required(world)), request).Options(Optional(request, "body"), Flag(request, "refused")));
            case "player_check":
                return Of(PlayerOf(StoreWorld.Open(Required(world)), request).Check(MoveOf(request), MoveBody(request)));
            case "player_submit":
                return Of(PlayerOf(StoreWorld.Open(Required(world)), request).Submit(MoveOf(request), MoveBody(request)));
            case "player_withdraw":
                return Of(PlayerOf(StoreWorld.Open(Required(world)), request).Withdraw(Optional(request, "body")));
            case "player_pending":
                return Obj(("moves", PlayerOf(StoreWorld.Open(Required(world)), request).Pending()));
            case "director_submitted":
                return Obj(("handles", new DirectorWorld(StoreWorld.Open(Required(world))).Submitted()));
            case "director_close_round":
                return Round(new DirectorWorld(StoreWorld.Open(Required(world))).CloseRound());
            case "director_edit":
                return Answer(
                    new DirectorWorld(StoreWorld.Open(Required(world))).Edit(
                        EditOf(request),
                        Optional(request, "command_id"),
                        Flag(request, "perceivers")),
                    Flag(request, "include_snapshot"));
            default:
                throw new WorldError(Code.InvalidOp, $"Unknown op {op}");
        }
    }

    // The shipped template set (templates/, copied beside the command line): what a world made without one is built from.
    private static IReadOnlyDictionary<string, Template> ShippedTemplates =>
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    // The files as they are, judged by the log's replay (`verifyWorld`): the answer names the first place they differ.
    private static Value.Map Verified(string dir)
    {
        var verification = WorldVerify.Verify(dir, WorldFiles.ReadTemplates(dir));
        if (verification.Ok)
        {
            return Obj(("ok", true), ("entries", verification.Entries), ("version", verification.Version));
        }
        var divergence = verification.Divergence!;
        return Obj(("ok", false), ("divergence", Obj(("file", divergence.File), ("line", divergence.Line), ("code", divergence.Code))));
    }

    private static Value.Map Verdict(Pipeline.Result result) => Obj(
        ("status", result.Status),
        ("command_id", result.CommandId),
        ("resolved_target", result.ResolvedTarget),
        ("candidates", result.Candidates),
        ("reason_code", result.ReasonCode),
        ("reason_data", result.ReasonData));

    // One write's answer (`commandResponse`): its verdict, the version after it, its deltas and events, and the snapshot or the actor's
    // observation when asked for. A spawn's delta is followed by one delta for each relation field the new entity came with.
    private static Value.Map Answer(Pipeline.Result result, bool includeSnapshot) => Verdict(result)
        .With("snapshot_version", result.Snapshot.Version)
        .With("deltas", ResponseDeltas(result.Deltas))
        .With("events", Of(result.Events))
        .With("snapshot", includeSnapshot ? Of(result.Snapshot) : null)
        .With("observation", Of(result.Observation));

    private static Value.List ResponseDeltas(IReadOnlyList<Delta> deltas)
    {
        var response = new List<Value>();
        foreach (var delta in deltas)
        {
            response.Add(Of(delta)!);
            if (delta.Field == "entity" && delta.To is Value.Map entity)
            {
                // A field the new entity leaves empty has no delta: it was nothing and is nothing.
                foreach (var field in new[] { "support", "contained_in", "location", "detached_from", "pos" })
                {
                    if (entity.GetValueOrDefault(field) is { } value)
                    {
                        response.Add(Obj(("event_id", delta.EventId), ("entity", delta.Entity), ("field", field), ("to", value)));
                    }
                }
            }
        }
        return Value.Of(response);
    }

    // A round's answer (`roundResponse`): its status, its reason when refused, its number when taken, each move's answer, and the close.
    private static Value.Map Round(Round.Outcome outcome) => Obj(
        ("status", outcome.Status),
        ("reason_code", outcome.ReasonCode),
        ("round", outcome.Number),
        ("results", Value.Of(outcome.Results.Select(result => (Value)Answer(result, false)))),
        ("closing", outcome.Closing is { } closing ? Answer(closing, false) : null));

    private static Value.Map Query(StoreWorld world, Value.Map query)
    {
        var answer = Text(query, "kind") switch
        {
            "fact" => world.QueryFact(Text(query, "subject"), Text(query, "relation"), Optional(query, "object")),
            "perceive" => world.QueryPerceive(Text(query, "observer"), Text(query, "sense"), Optional(query, "event_id"), Optional(query, "entity")),
            var kind => throw new WorldError(Code.InvalidQuery, $"Unknown query {kind}"),
        };
        return Obj(("value", answer.Value), ("basis_code", answer.BasisCode));
    }

    private static Value.Map QueryOf(Value.Map request) =>
        request.GetValueOrDefault("query") as Value.Map ?? throw new WorldError(Code.InvalidQuery, "The request names no query");

    private static List<Command> Commands(Value.Map request, string name) =>
        [.. (request.GetValueOrDefault(name) as Value.List ?? throw new WorldError(Code.InvalidRequest, "The request names no commands"))
            .Items.Select(WorldJson.Read<Command>)];

    private static Command CommandOf(Value.Map request) =>
        WorldJson.Read<Command>(request.GetValueOrDefault("command") ?? throw new WorldError(Code.InvalidCommand, "The request names no command"));

    // A controller's command as an actor sends it: its id, verb, target and args, never an actor or `perceivers` (`ActorCommand`).
    private static ActorCommand ActorCommandOf(Value.Map request) =>
        ActorCommandFrom(request.GetValueOrDefault("command") as Value.Map ?? throw new WorldError(Code.InvalidCommand, "The request names no command"));

    // A player's move: a command the view writes, with the body it is for when the slot holds several (`PlayerMove`).
    private static ActorCommand MoveOf(Value.Map request) =>
        ActorCommandFrom(request.GetValueOrDefault("move") as Value.Map ?? throw new WorldError(Code.InvalidMove, "The request names no move"));

    private static string? MoveBody(Value.Map request) => (request.GetValueOrDefault("move") as Value.Map)?.GetValueOrDefault("body").AsText();

    private static ActorCommand ActorCommandFrom(Value.Map command) =>
        new(Text(command, "command_id"), Text(command, "verb"), Optional(command, "target"), command.GetValueOrDefault("args") as Value.Map);

    // The request's edit as the engine reads it; the contract has checked it is one.
    private static Value.Map EditOf(Value.Map request) =>
        request.GetValueOrDefault("edit") as Value.Map ?? throw new WorldError(Code.InvalidEdit, "The request names no edit");

    // The view of the body the request names, as `actorWorld` builds it over the world.
    private static ActorWorld ActorOf(StoreWorld world, Value.Map request) => new(world, Text(request, "actor"), Optional(request, "via"));

    // The handle of a player, over the world, as `playerWorld` builds it for the handle the request names.
    private static PlayerWorld PlayerOf(StoreWorld world, Value.Map request) => new(world, Text(request, "handle"));

    private static string Text(Value.Map request, string name) =>
        Optional(request, name) ?? throw new WorldError(Code.InvalidRequest, $"The request names no {name}");

    private static string? Optional(Value.Map request, string name) => request.GetValueOrDefault(name).AsText();

    private static long? Int(Value.Map request, string name) => request.GetValueOrDefault(name).AsInt();

    private static bool Flag(Value.Map request, string name) => request.GetValueOrDefault(name).IsTrue();

    private static string Required(string? world) => world ?? throw new WorldError(Code.InvalidWorld, "The request names no world");

    private static long Version(Value.Map request) =>
        Int(request, "version") ?? throw new WorldError(Code.InvalidVersion, "The request names no version");

    // An answer's fields, each a value, a plain one (text, a number, a flag) or a record as the codec writes it; an empty one is left out.
    private static Value.Map Obj(params (string Key, object? Value)[] fields) =>
        Value.Of(fields.Select(field => KeyValuePair.Create(field.Key, Of(field.Value))));

    private static Value? Of(object? value) => value switch
    {
        null => null,
        Value already => already,
        string or bool or long or int => Value.From(value),
        _ => ValueJson.Of(value),
    };

    private static string Line(Value? answer) => CanonicalJson.Serialize(answer) + "\n";

    // A refused world call: its code, then each rule it broke, as `errorIssues` writes them.
    private static CliOutput Invalid(WorldError error)
    {
        var issues = new List<Value> { Issue(error.Code, WorldJson.Name(error.Code), []) };
        issues.AddRange(error.Issues.Select(rule => (Value)Issue(rule.Code, rule.Message, rule.Path)));
        return new CliOutput(Line(Obj(("status", "invalid"), ("issues", Value.Of(issues)))), 2);
    }

    private static Value.Map Issue(Code code, string message, IReadOnlyList<string> path) =>
        Obj(("code", code), ("message", message), ("path", Value.Of(path.Select(part => (Value)part))));

    // A refused request: the status and the one issue its code names, as `invalidFromIssues` writes it.
    private static CliOutput Invalid(Code code) => Invalid(new WorldError(code, WorldJson.Name(code)));
}
