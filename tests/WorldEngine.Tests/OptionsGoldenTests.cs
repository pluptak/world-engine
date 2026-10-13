using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// What an actor can try now (src/options.ts `listOptions`), each row's options compared with TypeScript's
// (Fixtures/options-golden.expected.json, from scratchpad/gen/options-golden.mjs). Each command is dry-run through the pipeline
// with the verb registry, as the world's own options are. A refusal (an unknown actor) is compared by code and message.
public class OptionsGoldenTests
{
    [Fact]
    public void Options_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("options-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var snapshot = WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString());
            var actual = Outcome(() => JsonNode.Parse(WorldJson.Write(Options.List(
                snapshot,
                TestTemplates.RepoRegistry,
                input["actor"]!.GetValue<string>(),
                input["refused"]!.GetValue<bool>(),
                command => Pipeline.Apply(snapshot, TestTemplates.RepoRegistry, VerbRegistry.All, command)))));
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == CanonicalJson.Serialize(actual),
                $"{name}: the options differ from TypeScript's");
        }
    }

    // The options as the golden writes them: under "ok", or the refusal's code and message.
    private static JsonNode Outcome(Func<JsonNode?> list)
    {
        try
        {
            return new JsonObject { ["status"] = "ok", ["options"] = list() };
        }
        catch (WorldError error)
        {
            return new JsonObject { ["status"] = "error", ["code"] = error.Code, ["message"] = error.Message };
        }
    }
}
