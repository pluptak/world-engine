using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// A scenario's names (src/scenario.ts `resolveScenario`) and a scene's beats and run (src/engine/scene.ts `sceneSnapshot`),
// each row's result compared with TypeScript's (Fixtures/scenario-golden.expected.json and scene-golden.expected.json, from
// scratchpad/gen/scene-golden.mjs). A refusal is compared by its code and message.
public class SceneGoldenTests
{
    private static readonly IReadOnlyDictionary<string, Template> Registry = TestTemplates.RepoRegistry;

    [Fact]
    public void Scenario_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("scenario-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var scenario = input["scenario"]!.AsArray();
            var nextSeq = input["next_seq"]!.GetValue<long>();
            var actual = Outcome(() =>
            {
                var resolved = ScenarioResolver.Resolve(scenario, nextSeq);
                return new JsonObject
                {
                    ["status"] = "ok",
                    ["scenario"] = resolved.Scenario.DeepClone(),
                    ["ids"] = new JsonObject(resolved.Ids.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)pair.Value))),
                };
            });
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == CanonicalJson.Serialize(actual),
                $"{name}: the result differs from TypeScript's");
        }
    }

    [Fact]
    public void Scene_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("scene-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var snapshot = WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString());
            var names = input["names"]!.AsObject()
                .ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>(), StringComparer.Ordinal);
            var beats = input["beats"] as JsonArray;
            var run = input["run"] as JsonObject;
            var actual = Outcome(() => new JsonObject
            {
                ["status"] = "ok",
                ["snapshot"] = JsonNode.Parse(WorldJson.Write(SceneBuilder.Build(snapshot, Registry, names, beats, run))),
            });
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == CanonicalJson.Serialize(actual),
                $"{name}: the result differs from TypeScript's");
        }
    }

    // The outcome of a build as the golden writes it: the value under "ok", or the refusal's code and message.
    private static JsonNode Outcome(Func<JsonNode> build)
    {
        try
        {
            return build();
        }
        catch (WorldError error)
        {
            return new JsonObject
            {
                ["status"] = "error",
                ["code"] = error.Code,
                ["message"] = error.Message,
            };
        }
    }
}
