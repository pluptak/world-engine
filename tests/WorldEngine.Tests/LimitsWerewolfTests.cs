using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// What `scenarios/werewolf.json` (wil, cursed to turn at moonrise, ada and a cart, in a lit village) cannot say today: each line of
// `docs/limits-werewolf.md` is one test. The scene is in code, with the ids the builder gives it (the village, wil, ada and the cart are e1
// to e4). The shipped set has no werewolf, so the tests add one extending `human`, as a story's library would.
public class LimitsWerewolfTests
{
    private const string Scene = """
        [
          { "id": "village", "template": "room", "overrides": { "name": "village", "props": { "lit": true } } },
          { "id": "wil", "template": "human", "overrides": { "name": "wil", "location": "village", "support": "village", "pos": { "x": -100, "y": 0 } } },
          { "id": "ada", "template": "human", "overrides": { "name": "ada", "location": "village", "support": "village", "pos": { "x": 100, "y": 0 } } },
          { "id": "cart", "template": "crate", "overrides": { "name": "cart", "location": "village", "support": "village", "pos": { "x": 0, "y": 200 } } }
        ]
        """;

    private const string Werewolf = """{ "id": "werewolf", "extends": "human", "props": { "attack_damage": 80, "hand_carry_limit_g": 160000 } }""";

    private const string Wil = "e2";

    private static IReadOnlyDictionary<string, Template> Registry { get; } = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "templates"), "*.json")
            .Select(file => (Path.GetFileName(file), File.ReadAllText(file)))
            .Append(("werewolf.json", Werewolf))));

    // The curse cannot take hold by itself: a beat carries no `refine`, so moonrise can only make a sound.
    [Fact]
    public void A_beat_cannot_turn_a_body_into_another_class()
    {
        var beat = Author(Built(), Value.Map.Empty.With("kind", "schedule_beat").With("id", "moonrise").With("at_tick", 10L)
            .With("action", Value.Map.Empty.With("kind", "refine").With("target", Wil).With("template", "werewolf")));

        Assert.Equal(Status.Invalid, beat.Status);
        Assert.Equal(Code.InvalidArgs, beat.ReasonCode);
    }

    // Only the author turns wil, and only down the lineage: the werewolf gets its own amounts, and no edit turns it back.
    [Fact]
    public void The_author_turns_a_body_down_its_lineage_and_never_back()
    {
        var turned = Author(Built(), Refine("werewolf"));
        Assert.Equal(Status.Ok, turned.Status);
        Assert.Equal(80L, turned.Snapshot.Entities[Wil].Props["attack_damage"].AsInt());

        var back = Author(turned.Snapshot, Refine("human"));
        Assert.Equal(Status.Refused, back.Status);
        Assert.Equal(Code.NotARefinement, back.ReasonCode);
    }

    // A stronger human is not written on the body: its amounts are definitions, and a capacity stops at 100 whatever lifts it.
    [Fact]
    public void Strength_is_the_class_not_the_body()
    {
        var stronger = Author(Built(), Value.Map.Empty.With("kind", "update_props").With("target", Wil).With("props", Value.Map.Empty.With("attack_damage", 80L)));
        Assert.Equal(Status.Refused, stronger.Status);
        Assert.Equal(Code.FieldNotEditable, stronger.ReasonCode);

        var lifted = Author(Built(), Value.Map.Empty.With("kind", "afflict").With("target", Wil).With("capacity", "moving").With("amount", 50L).With("until", 5L));
        Assert.Equal(Status.Ok, lifted.Status);
        Assert.Equal(100L, Capacities.Of(lifted.Snapshot, Registry, Wil, "moving"));
    }

    private static Value.Map Refine(string template) =>
        Value.Map.Empty.With("kind", "refine").With("target", Wil).With("template", template);

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Pipeline.Result Author(Snapshot snapshot, Value.Map edit) =>
        Pipeline.Apply(snapshot, Registry, VerbRegistry.All, new Command("c1", Resolve.WorldAuthor, "edit", edit.GetValueOrDefault("target").AsText(), Args: Value.Map.Empty.With("edit", edit)));
}
