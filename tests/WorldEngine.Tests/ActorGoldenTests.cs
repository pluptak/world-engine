using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The actor view (src/actor-world.ts `actorWorld`) over a memory world, driven through the calls the TypeScript golden made
// (Fixtures/actor-golden.expected.json, from scratchpad/gen/actor-golden.mjs). Views are made by `view` steps and used by the rest,
// so each answer is compared, including the state the calls leave behind.
public class ActorGoldenTests
{
    [Fact]
    public void Actor_view_steps_match_TypeScript()
    {
        var rows = GoldenRows.ReadRows("actor-golden.expected.json");
        var start = WorldJson.Read<Snapshot>(rows[0]!["args"]!["snapshot"]!.ToJsonString());
        var world = new MemoryWorld(start, TestTemplates.RepoRegistry, start.TemplatesHash);
        var views = new Dictionary<string, ActorWorld>(StringComparer.Ordinal);

        foreach (var step in rows.Skip(1))
        {
            var name = step!["name"]!.GetValue<string>();
            var args = step["args"]!;
            var actual = Outcome(() => Step(world, views, step["op"]!.GetValue<string>(), args));
            Meaning.Same(step["result"], actual, $"{name}: expected {step["result"]?.ToJsonString()}, got {actual?.ToJsonString()}");
        }
    }

    private static JsonNode? Step(MemoryWorld world, Dictionary<string, ActorWorld> views, string op, JsonNode args)
    {
        switch (op)
        {
            case "snapshot":
                return Json(world.CurrentSnapshot());
            case "view":
            {
                var view = new ActorWorld(
                    world,
                    args["actor"]!.GetValue<string>(),
                    args["key"]?.GetValue<string>(),
                    args["senses"]?.AsArray().Select(sense => sense!.GetValue<string>()).ToList());
                views[args["name"]!.GetValue<string>()] = view;
                return new JsonObject { ["actor"] = view.Actor };
            }
            case "alias":
                return ActorAlias.Of(args["actor"]!.GetValue<string>(), args["id"]!.GetValue<string>());
        }

        var viewName = args["view"]!.GetValue<string>();
        var target = views[viewName];
        return op switch
        {
            "observe" => WorldJson.Node(target.Observe(args["since_tick"]?.GetValue<long>())),
            "inspect" => WorldJson.Node(target.Inspect(args["entity"]!.GetValue<string>())),
            "check" => WorldJson.Node(target.Check(Read<ActorCommand>(args["command"]!))),
            "command" => WorldJson.Node(target.Apply(Read<ActorCommand>(args["command"]!))),
            "options" => WorldJson.Node(target.OptionsOf(args["refused"]?.GetValue<bool>() ?? false)),
            _ => throw new InvalidDataException($"unknown step {op}"),
        };
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
