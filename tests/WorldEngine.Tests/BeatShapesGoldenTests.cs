using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
namespace WorldEngine.Tests;

// The shape rules for a scheduled beat against TypeScript's (Fixtures/beat-shapes-golden.expected.json, from
// tools/golden-gen/beat-shapes-golden.ts): about a hundred `schedule_beat` edits, well formed and malformed in every way the shape rules
// tell apart (conditions, repeats, followers, actions, ids and ticks), then beats of each condition form left to run through an advance.
public class BeatShapesGoldenTests
{
    [Fact]
    public void Beat_shapes_and_runs_match_TypeScript() =>
        MemoryGoldenTests.Replay("beat-shapes-golden.expected.json", TestTemplates.RepoRegistry);

    // The one place .NET departs from TypeScript on purpose: TypeScript queues a condition whose value is a fraction, which puts a
    // non-integer in the snapshot (the canonical form holds integers only); here it is a malformed beat.
    [Fact]
    public void A_fractional_condition_value_is_a_malformed_beat()
    {
        var rows = GoldenRows.ReadRows("beat-shapes-golden.expected.json");
        var start = WorldEngine.Core.Json.WorldJson.Read<WorldEngine.Core.Model.Snapshot>(rows[0]!["args"]!["snapshot"]!.ToJsonString());
        var world = new WorldEngine.Core.Engine.MemoryWorld(start, TestTemplates.RepoRegistry, start.TemplatesHash);
        var edit = System.Text.Json.Nodes.JsonNode.Parse("""
            {"kind":"schedule_beat","id":"f","at_tick":5,"action":{"kind":"sound","entity":"e3"},
             "only_if":{"entity":"e5","prop":"fuel","op":"eq","value":1.5}}
            """)!.AsObject();
        var result = world.Edit(edit);
        Assert.Equal((Status.Invalid, (Code?)Code.InvalidArgs), (result.Status, result.ReasonCode));
    }
}
