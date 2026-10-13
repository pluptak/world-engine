using System.Text.Json.Nodes;
using WorldEngine.Cli;
using WorldEngine.Host;

namespace WorldEngine.Tests;

// The reference host (tests/host.test.ts) plays the lab fixture (Fixtures/host/host-lab.json: the lab-run scene with ann and bob in the lab
// beside the key) through the JSON ops only. The plan has a race for the key, the AI's terminal unlocking the exit door, and dee's move,
// which arrives after the round's timeout. Every answer is validated against the contract by the command line itself.
public class HostRunTests : IDisposable
{
    private static readonly string Scene = Fixture("host-lab.json");
    private readonly string root = Path.Combine(Path.GetTempPath(), "world-engine-host-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, true);
        }
    }

    private static string Fixture(string name) => Path.Combine(AppContext.BaseDirectory, "Fixtures", "host", name);

    private static JsonObject Plan() => JsonNode.Parse(File.ReadAllText(Fixture("host-plan.json")))!.AsObject();

    private static Dictionary<string, Player> Scripted(JsonObject plan) =>
        plan["handles"]!.AsObject().ToDictionary(p => p.Key, p => HostRun.Scripted(p.Value!["moves"]!.AsArray(), (int)plan["timeout_ms"]!));

    private async Task<(string Dir, HostResult Result)> Play(string? scene = null, Dictionary<string, Player>? players = null)
    {
        var plan = Plan();
        var dir = Path.Combine(root, "host");
        Directory.CreateDirectory(root);
        return (dir, await HostRun.Play(scene ?? Scene, plan, dir, players ?? Scripted(plan)));
    }

    private static Dictionary<string, JsonObject> Attempts(string dir)
    {
        var answer = JsonNode.Parse(CliRunner.Run([], new JsonObject { ["op"] = "attempts", ["world"] = dir, ["version"] = 0 }.ToJsonString()).Stdout)!;
        return answer["attempts"]!.AsArray().ToDictionary(a => (string)a!["command"]!["command_id"]!, a => a!.AsObject());
    }

    [Fact]
    public async Task The_lab_fixture_plays_two_rounds_one_subject_takes_the_key_and_the_other_is_preempted()
    {
        var (dir, result) = await Play();
        Assert.Equal(2, result.Rounds);
        Assert.Null(result.Ended);
        Assert.Equal([new Dropped(1, "dee")], result.Dropped);
        var attempts = Attempts(dir);
        Assert.Equal("ok", (string)attempts["ai-unlock"]["status"]!);
        Assert.Equal(["ok", "preempted"], new[] { "ann-key", "bob-key" }.Select(id => (string)attempts[id]["status"]!).Order().ToArray());
        Assert.Equal("ann", (string)attempts["ann-key"]["by"]!["handle"]!);
        var verified = JsonNode.Parse(CliRunner.Run([], new JsonObject { ["op"] = "verify", ["world"] = dir }.ToJsonString()).Stdout)!;
        Assert.True((bool)verified["ok"]!);
    }

    [Fact]
    public async Task A_late_answer_is_dropped_so_its_move_is_not_in_the_log_or_the_transcript()
    {
        var (dir, _) = await Play();
        Assert.DoesNotContain("dee-close", Attempts(dir).Keys);
        Assert.DoesNotContain("dee-close", File.ReadAllText(Path.Combine(dir, "transcript.jsonl")));
    }

    [Fact]
    public async Task The_transcript_starts_with_the_init_and_holds_two_closed_rounds()
    {
        var (dir, _) = await Play();
        var lines = File.ReadAllLines(Path.Combine(dir, "transcript.jsonl")).Select(line => JsonNode.Parse(line)!).ToList();
        Assert.Equal("init", (string)lines[0]["request"]!["op"]!);
        Assert.Equal("ok", (string)lines[0]["response"]!["status"]!);
        Assert.Equal(2, lines.Count(line => (string)line["request"]!["op"]! == "director_close_round"));
    }

    [Fact]
    public async Task A_player_that_answers_after_the_timeout_is_dropped_every_round_and_the_rounds_still_close()
    {
        var plan = Plan();
        var players = Scripted(plan);
        players["dee"] = async _ =>
        {
            await Task.Delay((int)plan["timeout_ms"]! * 3);
            return JsonNode.Parse("""{"command_id":"late-take","verb":"take","target":"key"}""")!;
        };
        var (dir, result) = await Play(players: players);
        Assert.Equal([new Dropped(0, "dee"), new Dropped(1, "dee")], result.Dropped);
        Assert.Equal(2, result.Rounds);
        Assert.DoesNotContain("late-take", Attempts(dir).Keys);
    }

    [Fact]
    public async Task A_run_that_ends_stops_the_host_before_the_plans_last_round()
    {
        // The tick limit is one tick, so the first round ends the run and the second is never played.
        Directory.CreateDirectory(root);
        var scene = JsonNode.Parse(File.ReadAllText(Scene))!.AsObject();
        scene["run"]!["tick_limit"] = 1;
        var short_ = Path.Combine(root, "short-scene.json");
        File.WriteAllText(short_, scene.ToJsonString());
        var (_, result) = await Play(short_);
        Assert.Equal(1, result.Rounds);
        Assert.Equal("tick_limit", result.Ended);
        Assert.Empty(result.Dropped);
    }
}
