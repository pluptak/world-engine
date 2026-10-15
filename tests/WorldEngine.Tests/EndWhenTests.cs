using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// A run's `end_when`: a condition in a beat's forms that ends a running run, reason `end_when`, after the ok command or edit
// that makes it hold (docs/run.md). TypeScript had no such field; the lab scene ends on reaching the outside with it.
public class EndWhenTests
{
    private static string Scene(string endWhen) => $$"""
        {
          "entities": [
            { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
            { "id": "outside", "template": "room", "overrides": { "name": "outside", "props": { "lit": true } } },
            { "id": "gate", "template": "door", "overrides": { "name": "gate", "props": { "open": true, "from": "hall", "to": "outside" } } },
            { "id": "ann", "template": "human", "overrides": { "name": "ann", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 0 } } },
            { "id": "bob", "template": "human", "overrides": { "name": "bob", "location": "hall", "support": "hall", "pos": { "x": 300, "y": 0 } } }
          ],
          "run": { "tick_limit": 10, "slots": ["ann", "bob"], "end_when": {{endWhen}} }
        }
        """;

    private const string Outside = """{ "room": "outside", "occupied": true }""";

    private static MemoryWorld Started(string endWhen)
    {
        var made = WorldBuilder.Snapshot(ValueJson.Parse(Scene(endWhen))!, TestTemplates.RepoRegistry);
        var world = new MemoryWorld(made.Snapshot, TestTemplates.RepoRegistry, made.Snapshot.TemplatesHash, made.Ids);
        Assert.Equal(Status.Ok, world.Edit(Value.Map.Empty.With("kind", "start_run")).Status);
        return world;
    }

    private static Command Through(MemoryWorld world, string who) =>
        new($"{who}-out", world.Id(who)!, "move", Args: Value.Map.Empty.With("through", world.Id("gate")!));

    [Fact]
    public void The_scene_keeps_the_condition_with_its_names_bound_to_ids()
    {
        var world = Started(Outside);

        Assert.Equal(new BeatCondition(Room: world.Id("outside"), Occupied: true), world.CurrentSnapshot().Run!.EndWhen);
    }

    [Fact]
    public void A_run_ends_when_the_move_that_makes_it_hold_is_taken()
    {
        var world = Started(Outside);

        var round = world.TakeRound([Through(world, "ann")]);

        Assert.Equal(Status.Ok, round.Results[0].Status);
        var run = world.CurrentSnapshot().Run!;
        Assert.Equal("ended", run.State);
        Assert.Equal(new RunEnd("end_when", 0), run.Ended);
        // The round's closing tick comes after the end, so it is refused as any command after an end is.
        Assert.Equal(Code.RunEnded, round.ReasonCode);
    }

    [Fact]
    public void A_run_goes_on_while_the_condition_does_not_hold()
    {
        var world = Started("""{ "all": [{ "entity": "ann", "in": "outside" }, { "entity": "bob", "in": "outside" }] }""");

        world.TakeRound([Through(world, "ann")]);

        Assert.Equal("running", world.CurrentSnapshot().Run!.State);
        world.TakeRound([Through(world, "bob")]);
        Assert.Equal(new RunEnd("end_when", 1), world.CurrentSnapshot().Run!.Ended);
    }

    [Theory]
    [InlineData("""{ "room": "outside" }""", "run.end_when: invalid_run")]
    [InlineData("""{ "room": "moon", "occupied": true }""", "run.end_when.room: no_such_entity")]
    public void A_scene_with_a_malformed_or_unknown_condition_is_refused(string endWhen, string message)
    {
        var error = Assert.Throws<WorldError>(() => WorldBuilder.Snapshot(ValueJson.Parse(Scene(endWhen))!, TestTemplates.RepoRegistry));

        Assert.Equal(Code.InvalidScenario, error.Code);
        Assert.Equal(message, error.Message);
    }
}
