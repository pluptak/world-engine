using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
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
            return new CliOutput(Line(Dispatch(request)), 0);
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
