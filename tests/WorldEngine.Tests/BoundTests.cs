using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// Binding takes capacities as losing a part does (`docs/structure.md`): a body `bound` has no moving and no manipulation, and a bound
// part takes what it and the parts under it contribute. The human is e2, as the builder numbers the scene.
public class BoundTests : IDisposable
{
    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
          { "id": "human", "template": "human", "overrides": { "name": "human", "location": "room", "support": "room", "pos": { "x": 0, "y": 0 } } },
          { "id": "bound", "template": "human", "overrides": { "name": "bound", "location": "room", "support": "room", "pos": { "x": 100, "y": 0 }, "props": { "bound": true } } },
          { "id": "pebble", "template": "stone", "overrides": { "name": "pebble", "location": "room", "support": "room", "pos": { "x": 20, "y": 0 } } },
          { "id": "flint", "template": "stone", "overrides": { "name": "flint", "location": "room", "support": "room", "pos": { "x": 30, "y": 0 } } }
        ]
        """;

    // The two stones beside the free human, as the builder numbers them after the bound one (e3).
    private const string Pebble = "e4";
    private const string Flint = "e5";

    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["edit"] = EditVerb.Edit,
        ["move"] = MoveVerb.Move,
        ["say"] = SayVerb.Say,
        ["take"] = TakeVerb.Take,
    };

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "bound-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(scratch, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    [Fact]
    public void A_bound_body_has_no_moving_or_manipulation_and_keeps_its_senses_and_speech()
    {
        var snapshot = Built();

        Assert.Equal(0L, Capacities.Of(snapshot, Registry, "e3", "moving"));
        Assert.Equal(0L, Capacities.Of(snapshot, Registry, "e3", "manipulation"));
        Assert.Equal(100L, Capacities.Of(snapshot, Registry, "e3", "sight"));
        Assert.Equal(100L, Capacities.Of(snapshot, Registry, "e3", "speech"));

        var said = Pipeline.Apply(snapshot, Registry, Verbs, new Command("c1", "e3", "say", Args: Value.Map.Empty.With("utterance", "hello")));
        Assert.Equal(Status.Ok, said.Status);
    }

    [Fact]
    public void Binding_a_hand_takes_its_own_and_its_thumbs_manipulation_and_leaves_the_other_hand()
    {
        var bound = Pipeline.Apply(Built(), Registry, Verbs, SetPart("e2", "hand_l", integrity: 100, status: "intact", bound: true));

        Assert.Equal(Status.Ok, bound.Status);
        Assert.Equal(50L, Capacities.Of(bound.Snapshot, Registry, "e2", "manipulation"));
        Assert.Equal(100L, Capacities.Of(bound.Snapshot, Registry, "e2", "moving"));
    }

    [Fact]
    public void A_bound_body_cannot_move()
    {
        var moved = Pipeline.Apply(Built(), Registry, Verbs, new Command("c1", "e3", "move", Args: Value.Map.Empty.With("to", Value.Map.Empty.With("x", 150L).With("y", 0L))));

        Assert.Equal(Status.Refused, moved.Status);
        Assert.Equal(Code.InsufficientMoving, moved.ReasonCode);
    }

    [Fact]
    public void What_a_hand_holds_stays_held_when_it_is_bound()
    {
        var taken = Pipeline.Apply(Built(), Registry, Verbs, new Command("c1", "e2", "take", Pebble));
        Assert.Equal(Status.Ok, taken.Status);
        Assert.Equal("hand_l", taken.Snapshot.Entities[Pebble].InPart);

        var bound = Pipeline.Apply(taken.Snapshot, Registry, Verbs, SetPart("e2", "hand_l", integrity: 100, status: "intact", bound: true));

        Assert.Equal(Status.Ok, bound.Status);
        Assert.Equal("e2", bound.Snapshot.Entities[Pebble].ContainedIn);
        Assert.Equal("hand_l", bound.Snapshot.Entities[Pebble].InPart);
    }

    [Fact]
    public void A_bound_hand_takes_nothing_new()
    {
        var bound = Pipeline.Apply(Built(), Registry, Verbs, SetPart("e2", "hand_l", integrity: 100, status: "intact", bound: true));

        var first = Pipeline.Apply(bound.Snapshot, Registry, Verbs, new Command("c1", "e2", "take", Pebble));
        Assert.Equal(Status.Ok, first.Status);
        Assert.Equal("hand_r", first.Snapshot.Entities[Pebble].InPart);

        var second = Pipeline.Apply(first.Snapshot, Registry, Verbs, new Command("c2", "e2", "take", Flint));
        Assert.Equal(Status.Refused, second.Status);
        Assert.Equal(Code.HandsFull, second.ReasonCode);
    }

    [Fact]
    public void Clearing_the_binding_restores_the_capacities()
    {
        var bound = Pipeline.Apply(Built(), Registry, Verbs, SetPart("e2", "hand_l", integrity: 100, status: "intact", bound: true));
        var freed = Pipeline.Apply(bound.Snapshot, Registry, Verbs, SetPart("e2", "hand_l", integrity: 100, status: "intact"));

        Assert.Equal(Status.Ok, freed.Status);
        Assert.Equal(100L, Capacities.Of(freed.Snapshot, Registry, "e2", "manipulation"));
        Assert.Null(freed.Snapshot.Entities["e2"].Parts.GetValueOrDefault("hand_l"));
    }

    [Fact]
    public void A_store_world_folds_the_binding_alike()
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry);
        var expected = Pipeline.Apply(made.Snapshot, Registry, Verbs, SetPart("e2", "hand_l", integrity: 100, status: "intact", bound: true));

        WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
        var world = StoreWorld.Open(scratch);
        Assert.Equal(Status.Ok, world.Edit(SetPartEdit("hand_l", integrity: 100, status: "intact", bound: true)).Status);

        Assert.Equal(WorldJson.Write(expected.Snapshot), WorldJson.Write(world.CurrentSnapshot()));
        Assert.True(world.Verify().Ok);
    }

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Command SetPart(string target, string part, long integrity, string status, bool? bound = null) =>
        new("e-set", Resolve.WorldAuthor, "edit", target, Args: Value.Map.Empty.With("edit", SetPartEdit(part, integrity, status, bound, target)));

    private static Value.Map SetPartEdit(string part, long integrity, string status, bool? bound = null, string? target = null)
    {
        var state = Value.Map.Empty.With("integrity", integrity).With("status", status);
        if (bound is { } tied)
        {
            state = state.With("bound", tied);
        }
        return Value.Map.Empty.With("kind", "set_part").With("target", target ?? "e2").With("part", part).With("state", state);
    }
}
