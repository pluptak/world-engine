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
        var rows = GoldenRows.ReadRows("options-golden.expected.json");
        foreach (var row in rows)
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
            if (GoldenUpdate.Enabled)
            {
                row["result"] = actual.DeepClone();
                continue;
            }
            Meaning.Same(row["result"], actual, $"{name}: the options differ from TypeScript's");
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("options-golden.expected.json", rows);
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
            return new JsonObject { ["status"] = "error", ["code"] = WorldJson.Name(error.Code), ["message"] = error.Message };
        }
    }
}
