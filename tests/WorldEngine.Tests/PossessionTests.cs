using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// A curse (`docs/possession.md`) on one human: `scenarios/curse.json` in code, with the ids the builder gives it (the room, the curser,
// the victim and the curse are e1 to e4).
public class PossessionTests : IDisposable
{
    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
          { "id": "curser", "template": "human", "overrides": { "name": "curser", "location": "room", "support": "room", "pos": { "x": -200, "y": 0 } } },
          { "id": "victim", "template": "human", "overrides": { "name": "victim", "location": "room", "support": "room", "pos": { "x": 200, "y": 0 }, "props": { "possessed_by": "curse" } } },
          { "id": "curse", "template": "curse", "overrides": { "name": "curse", "location": "room", "support": "room", "pos": { "x": 0, "y": 0 }, "props": { "possessor": "curser", "lapses_at": 5 } } }
        ]
        """;

    private const string Victim = "e3";
    private const string Curser = "e2";
    private const string Curse = "e4";

    // The TypeScript set plus the curse, which TypeScript never had (`templates/curse.json`, copied under Fixtures).
    private static IReadOnlyDictionary<string, Template> Registry { get; } = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates"), "*.json")
            .Concat(Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "possession-templates"), "*.json"))
            .Select(file => (Path.GetFileName(file), File.ReadAllText(file)))));

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["edit"] = EditVerb.Edit,
        ["wait"] = WaitVerb.Wait,
    };

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "possession-" + Guid.NewGuid().ToString("N"));

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
    public void The_possessed_body_acts_only_at_its_possessors_word()
    {
        var snapshot = Built();
        Assert.Equal(Curser, Possession.Holder(snapshot, Victim));

        var own = Pipeline.Apply(snapshot, Registry, Verbs, Wait(Victim, actor: Victim));
        Assert.Equal(Status.Refused, own.Status);
        Assert.Equal(Code.Possessed, own.ReasonCode);

        var sent = Pipeline.Apply(snapshot, Registry, Verbs, Wait(Victim, actor: Victim, via: Curser));
        Assert.Equal(Status.Ok, sent.Status);
    }

    [Fact]
    public void At_the_lapse_the_body_acts_for_itself_and_the_curser_is_refused()
    {
        var snapshot = Built();
        var held = Pipeline.Apply(snapshot, Registry, Verbs, Wait(Curser, actor: Victim, via: Curser, ticks: 5));
        Assert.Equal(Status.Ok, held.Status);

        Assert.Null(Possession.Holder(held.Snapshot, Victim));
        Assert.Equal(Status.Ok, Pipeline.Apply(held.Snapshot, Registry, Verbs, Wait(Victim, actor: Victim)).Status);
        var late = Pipeline.Apply(held.Snapshot, Registry, Verbs, Wait(Victim, actor: Victim, via: Curser));
        Assert.Equal(Status.Refused, late.Status);
        Assert.Equal(Code.NotController, late.ReasonCode);
    }

    [Fact]
    public void A_removed_curse_still_named_is_a_dangling_reference()
    {
        var removed = Pipeline.Apply(Built(), Registry, Verbs, new Command("e-rm", Resolve.WorldAuthor, "edit", Curse, Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "remove").With("target", Curse))));

        Assert.Equal(Status.Refused, removed.Status);
        Assert.Equal(Code.DanglingReference, removed.ReasonCode);
    }

    [Fact]
    public void A_store_world_folds_the_curse_alike()
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry);
        var expected = Pipeline.Apply(made.Snapshot, Registry, Verbs, Wait(Victim, actor: Victim, via: Curser));

        WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
        var world = StoreWorld.Open(scratch);
        Assert.Equal(Status.Ok, world.Apply(Wait(Victim, actor: Victim, via: Curser)).Status);

        Assert.Equal(WorldJson.Write(expected.Snapshot), WorldJson.Write(world.CurrentSnapshot()));
        Assert.True(world.Verify().Ok);
    }

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Command Wait(string target, string actor, string? via = null, long ticks = 1) =>
        new("e-wait", actor, "wait", Args: Value.Map.Empty.With("ticks", ticks), Via: via);
}
