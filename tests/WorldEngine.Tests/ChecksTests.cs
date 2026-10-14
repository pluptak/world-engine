using System.Text.Json.Nodes;
using WorldEngine.Cli;
using WorldEngine.Contract;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

public class ChecksTests
{
    // A request as the command line reads it: none when it cannot be a value, which the contract refuses.
    private static Value? Parse(string json) => ValueJson.TryFromNode(JsonNode.Parse(json), out var value) ? value : null;

    [Theory]
    [InlineData("""{"op":"snapshot","world":"w"}""")]
    [InlineData("""{"op":"verbs"}""")]
    [InlineData("""{"op":"catalog"}""")]
    [InlineData("""{"op":"command","world":"w","command":{"actor":"e1","command_id":"c1","verb":"wait","args":{"ticks":9007199254740992}},"observe":true}""")]
    [InlineData("""{"op":"edit","world":"w","edit":{"kind":"start_run"},"based_on_version":3}""")]
    [InlineData("""{"op":"query","world":"w","query":{"kind":"fact","subject":"e1","relation":"near"}}""")]
    [InlineData("""{"op":"trace","world":"w","query":{"entity":"e1","field":"pos"}}""")]
    [InlineData("""{"op":"player_submit","world":"w","handle":"h","move":{"command_id":"c","verb":"wait"}}""")]
    public void A_request_of_the_shape_of_its_op_is_accepted(string json) => Assert.True(Checks.IsRequest(Parse(json)));

    [Theory]
    [InlineData("""{"op":"snapshot"}""")]
    [InlineData("""{"op":"snapshot","world":""}""")]
    [InlineData("""{"op":"snapshot","world":"w","extra":1}""")]
    [InlineData("""{"op":"schema"}""")]
    [InlineData("""{"op":"nothing"}""")]
    [InlineData("""{"world":"w"}""")]
    [InlineData("""{"op":"since","world":"w","version":1.5}""")]
    [InlineData("""{"op":"command","world":"w","command":{"command_id":"c1","verb":"wait"}}""")]
    [InlineData("""{"op":"command","world":"w","command":{"actor":"e1","command_id":"c1","verb":"wait"},"observe":"yes"}""")]
    [InlineData("""{"op":"command","world":"w","command":{"actor":"e1","args":{"ticks":1.5},"command_id":"c1","verb":"wait"}}""")]
    [InlineData("""{"op":"command","world":"w","command":{"actor":"e1","args":{"to":{"x":1.5,"y":0}},"command_id":"c1","verb":"move"}}""")]
    [InlineData("""{"op":"actor_command","world":"w","actor":"e1","command":{"args":{"amount":1.5},"command_id":"c1","verb":"consume"}}""")]
    [InlineData("""{"op":"edit","world":"w","edit":{"target":"e1"}}""")]
    [InlineData("""{"op":"edit","world":"w","edit":{"kind":"spawn","template":"stone","overrides":{"residue":{"wine":1.5}}}}""")]
    [InlineData("""{"op":"edit","world":"w","edit":{"kind":"schedule_beat","id":"b","at_tick":2.5,"action":{"kind":"sound","entity":"e3"}}}""")]
    [InlineData("""{"op":"edit","world":"w","edit":{"kind":"schedule_beat","id":"b","at_tick":5,"action":{"kind":"sound","entity":"e3"},"only_if":{"entity":"e5","prop":"fuel","op":"eq","value":1.5}}}""")]
    [InlineData("""{"op":"schedule","world":"w","filter":{"kind":"tomorrow"}}""")]
    [InlineData("""{"op":"query","world":"w","query":{"kind":"fact","subject":"e1"}}""")]
    public void A_request_that_does_not_fit_its_op_is_refused(string json) => Assert.False(Checks.IsRequest(Parse(json)));

    [Fact]
    public void A_refused_request_is_answered_invalid_with_exit_code_2()
    {
        var output = CliRunner.Run([], """{"op":"snapshot"}""");
        Assert.Equal(2, output.Status);
        Assert.Contains("invalid_request", output.Stdout);
    }

    [Theory]
    [InlineData("""[{"template":"human"}]""", true)]
    [InlineData("""[{"template":"human","id":"hero","overrides":{"pos":{"x":1,"y":2},"integrity":50}}]""", true)]
    [InlineData("""{"entities":[{"template":"human"}],"seed":42}""", true)]
    [InlineData("""[{"id":"hero"}]""", false)]
    [InlineData("""[{"template":"human","overrides":{"integrity":1.5}}]""", false)]
    [InlineData("""[{"template":"human","overrides":{"unknown":1}}]""", false)]
    [InlineData("""[{"template":"human","overrides":{"fuel_pct":2.5}}]""", false)]
    [InlineData("""[{"template":"human","overrides":{"support":null,"clear":["in_part"]}}]""", true)]
    [InlineData("""{"entities":[],"seed":-1}""", false)]
    [InlineData("""{"entities":[],"run":{"tick_limit":0}}""", false)]
    [InlineData("null", false)]
    public void A_scenario_is_a_list_of_entries_or_a_scene(string json, bool valid) =>
        Assert.Equal(valid, Checks.IsScenario(Parse(json)));

    [Theory]
    [InlineData("""{"relations":[],"senses":[],"properties":[]}""", true)]
    [InlineData("""{"relations":[],"senses":[]}""", false)]
    [InlineData("""{"relations":[],"senses":[],"properties":[],"more":[]}""", false)]
    public void A_coverage_names_its_three_lists(string json, bool valid) => Assert.Equal(valid, Checks.IsCoverage(Parse(json)));
}
