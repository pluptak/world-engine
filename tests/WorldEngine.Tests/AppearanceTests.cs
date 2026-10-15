using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Identity by appearance, on the disguise scene (the hall, sean, castor and the guard are e1 to e4).
public class AppearanceTests
{
    private const string Scene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "sean", "template": "human", "overrides": { "name": "sean", "location": "hall", "support": "hall", "pos": { "x": -100, "y": 0 } } },
          { "id": "castor", "template": "human", "overrides": { "name": "castor", "location": "hall", "support": "hall", "pos": { "x": 100, "y": 0 } } },
          { "id": "guard", "template": "human", "overrides": { "name": "guard", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 200 } } }
        ]
        """;

    private const string Sean = "e2";
    private const string Castor = "e3";
    private const string Guard = "e4";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    // A face is worn by scene props and by the author's update_props, resolved to the entity id.
    [Fact]
    public void Wearing_a_face_is_written_by_scene_props_and_update_props()
    {
        var scene = (Value.List)ValueJson.Parse(Scene)!;
        var worn = scene.Items.Append((Value)ValueJson.Parse(
            """{ "id": "extra", "template": "human", "overrides": { "name": "extra", "location": "hall", "support": "hall", "pos": { "x": 0, "y": -200 }, "props": { "appearance": "sean" } } }""")!);
        var built = WorldBuilder.Snapshot(Value.Of(worn.ToList()), Registry).Snapshot;
        Assert.Equal(Sean, built.Entities["e5"].Props.Get(Prop.Appearance));

        var updated = Author(Value.Map.Empty.With("kind", "update_props").With("target", Castor).With("props", Value.Map.Empty.With("appearance", Sean)));
        Assert.Equal(Status.Ok, updated.Status);
    }

    // The entity a worn face names cannot be removed while it is worn.
    [Fact]
    public void Removing_the_worn_over_entity_is_dangling_reference()
    {
        var worn = Author(Value.Map.Empty.With("kind", "update_props").With("target", Castor).With("props", Value.Map.Empty.With("appearance", Sean)));
        Assert.Equal(Status.Ok, worn.Status);

        var removed = Pipeline.Apply(
            worn.Snapshot, Registry, VerbRegistry.All,
            new Command("c2", Resolve.WorldAuthor, "edit", Sean, Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "remove").With("target", Sean))));
        Assert.Equal(Status.Refused, removed.Status);
        Assert.Equal(Code.DanglingReference, removed.ReasonCode);
    }

    // An appearance naming nothing is refused.
    [Fact]
    public void Appearance_of_an_unknown_id_is_refused()
    {
        var renamed = Author(Value.Map.Empty.With("kind", "update_props").With("target", Castor).With("props", Value.Map.Empty.With("appearance", "e99")));

        Assert.Equal(Status.Refused, renamed.Status);
        Assert.Equal(Code.DanglingReference, renamed.ReasonCode);
    }

    private const string WornScene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "sean", "template": "human", "overrides": { "name": "sean", "location": "hall", "support": "hall", "pos": { "x": -100, "y": 0 } } },
          { "id": "castor", "template": "human", "overrides": { "name": "castor", "location": "hall", "support": "hall", "pos": { "x": 100, "y": 0 }, "props": { "appearance": "sean" } } },
          { "id": "guard", "template": "human", "overrides": { "name": "guard", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 200 } } }
        ]
        """;

    private static readonly Coverage TouchedCoverage = new(
        WorldBuilder.DefaultCoverage.Relations,
        [Sense.Sight, Sense.Hearing, Sense.Smell, Sense.Touch],
        WorldBuilder.DefaultCoverage.Properties);

    private static Snapshot Worn() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(WornScene))!, Registry, TouchedCoverage).Snapshot;

    private static MemoryWorld WornWorld()
    {
        var snapshot = Worn();
        return new MemoryWorld(snapshot, Registry, snapshot.TemplatesHash);
    }

    private static MemoryWorld AppliedWorld(Value.Map edit, string target)
    {
        var result = Pipeline.Apply(
            Worn(), Registry, VerbRegistry.All,
            new Command("c1", Resolve.WorldAuthor, "edit", target, Args: Value.Map.Empty.With("edit", edit)));
        Assert.Equal(Status.Ok, result.Status);
        return new MemoryWorld(result.Snapshot, Registry, result.Snapshot.TemplatesHash);
    }

    // A seen body is shown by the face it wears: the guard gets one alias for both, named sean.
    [Fact]
    public void Guard_gets_one_alias_for_both_named_sean()
    {
        var view = new ActorWorld(WornWorld(), Guard);
        var seen = view.Observe().Entities.Where(entity => entity.Name == "sean").ToList();

        Assert.Equal(2, seen.Count);
        Assert.Equal(seen[0].Id, seen[1].Id);
        Assert.Equal(ActorAlias.Of(Guard, Sean), seen[0].Id);
        Assert.All(seen, entity => Assert.Equal("human", entity.Template));

        var inspection = view.Inspect(seen[0].Id);
        Assert.NotNull(inspection);
        Assert.Equal("sean", inspection.Name);
        Assert.Equal("human", inspection.Template);
    }

    // Touch sees through the face: a guard holding castor gets castor's own alias and name,
    // while sight-only sean still names the face.
    [Fact]
    public void Touch_sees_through_it()
    {
        var world = AppliedWorld(
            Value.Map.Empty.With("kind", "place").With("target", Castor).With("contained_in", Guard).With("in_part", "hand_r")
                .With("clear", new Value.List([new Value.Text("pos")])),
            Castor);
        var view = new ActorWorld(world, Guard);
        var castor = view.Observe().Entities.Single(entity => entity.Name == "castor");

        Assert.Equal(ActorAlias.Of(Guard, Castor), castor.Id);
        Assert.Contains(castor.Senses, sense => sense == "touch");

        var afar = new ActorWorld(world, Sean);
        Assert.DoesNotContain(afar.Observe().Entities, entity => entity.Name == "castor");
        Assert.Equal(2, afar.Observe().Entities.Count(entity => entity.Name == "sean"));
    }

    // Clearing the face brings the body's own alias back.
    [Fact]
    public void Clearing_appearance_brings_castors_alias_back()
    {
        var world = WornWorld();
        var props = world.CurrentSnapshot().Entities[Castor].Props.Without(Prop.Appearance);
        var cleared = world.Apply(new Command("c1", Resolve.WorldAuthor, "edit", Castor,
            Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "set_props").With("target", Castor).With("props", props))));
        Assert.Equal(Status.Ok, cleared.Status);
        var view = new ActorWorld(world, Guard);
        var castor = view.Observe().Entities.Single(entity => entity.Name == "castor");

        Assert.Equal(ActorAlias.Of(Guard, Castor), castor.Id);
    }

    // No alias, name, fact, event or verdict in the guard's view leads back to the worn-over id.
    [Fact]
    public void No_view_leaks_the_worn_over_id()
    {
        var view = new ActorWorld(WornWorld(), Guard);
        var observation = view.Observe();
        var shared = observation.Entities.First(entity => entity.Name == "sean").Id;
        var verdict = view.Check(new ActorCommand("c1", "attack", Target: shared));
        var text = WorldJson.Write(observation) + "\n"
            + string.Concat(observation.Entities.Select(entity => WorldJson.Write(view.Inspect(entity.Id)))) + "\n"
            + WorldJson.Write(verdict);

        Assert.DoesNotContain("\"" + Castor + "\"", text);
        Assert.DoesNotContain("castor", text);
    }

    // An event's entity is the face its observer sees.
    [Fact]
    public void Events_name_the_face()
    {
        var world = WornWorld();
        world.Apply(new Command("c1", Castor, "wait", Args: Value.Map.Empty.With("ticks", 1)), observe: true);
        var view = new ActorWorld(world, Guard);
        var waited = view.Observe(0).Events.Single(@event => @event.Type == "wait");

        Assert.Equal(ActorAlias.Of(Guard, Sean), waited.Entity);
    }

    // A reference to the body uses the shown id: facts of what it holds, and what holds it.
    [Fact]
    public void Facts_and_holds_name_the_face()
    {
        var world = WornWorld();
        var spawned = world.Apply(new Command("c1", Resolve.WorldAuthor, "edit", null,
            Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "spawn").With("template", "stone").With("overrides",
                Value.Map.Empty.With("name", "pebble").With("contained_in", Castor).With("in_part", "hand_r")))));
        Assert.Equal(Status.Ok, spawned.Status);
        var view = new ActorWorld(world, Guard);
        var pebble = view.Observe().Entities.Single(entity => entity.Name == "pebble");

        Assert.Equal(ActorAlias.Of(Guard, Sean), pebble.Facts!.ContainedIn);
    }

    // A slot's bodies read as one: senses merge across bodies, so two sight-only bodies
    // name the face under the slot's key.
    [Fact]
    public void Merged_senses_across_bodies_decide_what_is_shown()
    {
        var view = new ActorWorld(WornWorld(), Sean, key: "slot", senses: [Sean, Guard]);
        var seen = view.Observe().Entities.Where(entity => entity.Name == "sean").ToList();

        Assert.Equal(2, seen.Count);
        Assert.Equal(ActorAlias.Of("slot", Sean), seen[0].Id);
    }

    // A store world folds alike: the same one alias, named sean.
    [Fact]
    public void Store_world_folds_alike()
    {
        var scratch = Path.Combine(Path.GetTempPath(), "appearance-" + Guid.NewGuid().ToString("N"));
        try
        {
            var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(WornScene))!, Registry, TouchedCoverage);
            WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
            var view = new ActorWorld(StoreWorld.Open(scratch), Guard);
            var seen = view.Observe().Entities.Where(entity => entity.Name == "sean").ToList();

            Assert.Equal(2, seen.Count);
            Assert.Equal(ActorAlias.Of(Guard, Sean), seen[0].Id);
        }
        finally
        {
            Directory.Delete(scratch, recursive: true);
        }
    }

    // A command naming the shared alias is ambiguous with both as candidates, and nothing is applied.
    [Fact]
    public void Command_naming_the_shared_alias_is_ambiguous()
    {
        var world = WornWorld();
        var before = world.CurrentSnapshot().Version;
        var view = new ActorWorld(world, Guard);
        var shared = ActorAlias.Of(Guard, Sean);

        var checked_ = view.Check(new ActorCommand("c1", "attack", Target: shared));
        Assert.Equal(Status.Ambiguous, checked_.Status);
        Assert.Equal([shared, shared], checked_.Candidates);

        var applied = view.Apply(new ActorCommand("c2", "attack", Target: shared));
        Assert.Equal(Status.Ambiguous, applied.Status);
        Assert.Equal(before, world.CurrentSnapshot().Version);
    }

    // A name resolves against the shown names the same way.
    [Fact]
    public void Command_naming_sean_is_ambiguous()
    {
        var view = new ActorWorld(WornWorld(), Guard);

        var checked_ = view.Check(new ActorCommand("c1", "attack", Target: "sean"));
        Assert.Equal(Status.Ambiguous, checked_.Status);
        Assert.Equal(2, checked_.Candidates!.Count);
    }

    // A shown name owned by one body resolves to it, through the pipeline's own gate.
    [Fact]
    public void Single_shown_name_resolves()
    {
        var world = WornWorld();
        var props = world.CurrentSnapshot().Entities[Castor].Props.Without(Prop.Appearance);
        var cleared = world.Apply(new Command("c1", Resolve.WorldAuthor, "edit", Castor,
            Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "set_props").With("target", Castor).With("props", props))));
        Assert.Equal(Status.Ok, cleared.Status);

        var checked_ = new ActorWorld(world, Guard).Check(new ActorCommand("c2", "attack", Target: "sean"));
        Assert.NotEqual(Status.Ambiguous, checked_.Status);
        Assert.Equal(ActorAlias.Of(Guard, Sean), checked_.ResolvedTarget);
    }

    private const string LoneScene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "far", "template": "room", "overrides": { "name": "far", "props": { "lit": true } } },
          { "id": "sean", "template": "human", "overrides": { "name": "sean", "location": "far", "support": "far", "pos": { "x": 0, "y": 0 } } },
          { "id": "guard", "template": "human", "overrides": { "name": "guard", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 200 } } },
          { "id": "castor", "template": "human", "overrides": { "name": "castor", "location": "hall", "support": "hall", "pos": { "x": 100, "y": 0 }, "props": { "appearance": "sean" } } }
        ]
        """;

    // The face's owner elsewhere: the lone bearer is commanded, inspected and named by what the view shows.
    [Fact]
    public void Lone_bearer_is_commanded_by_what_the_view_shows()
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(LoneScene))!, Registry, TouchedCoverage);
        var world = new MemoryWorld(made.Snapshot, Registry, made.Snapshot.TemplatesHash);
        var castor = made.Ids["castor"];
        var view = new ActorWorld(world, made.Ids["guard"]);
        var shown = ActorAlias.Of(made.Ids["guard"], made.Ids["sean"]);

        var seen = view.Observe().Entities.Where(entity => entity.Name == "sean").ToList();
        Assert.Single(seen);
        Assert.Equal(shown, seen[0].Id);

        var byAlias = view.Check(new ActorCommand("c1", "attack", Target: shown));
        Assert.Equal(Status.Refused, byAlias.Status);
        Assert.Equal(shown, byAlias.ResolvedTarget);

        var byName = view.Check(new ActorCommand("c2", "attack", Target: "sean"));
        Assert.Equal(Status.Refused, byName.Status);
        Assert.Equal(shown, byName.ResolvedTarget);

        var inspection = view.Inspect(shown);
        Assert.NotNull(inspection);
        Assert.Equal("sean", inspection.Name);
    }

    // Smell sees through the face as touch does: a horse smells the water on castor.
    [Fact]
    public void Smell_sees_through_it()
    {
        var world = WornWorld();
        var smelled = world.Apply(new Command("c1", Resolve.WorldAuthor, "edit", Castor,
            Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "update_props").With("target", Castor)
                .With("props", Value.Map.Empty.With("liquid_material", "water")))));
        Assert.Equal(Status.Ok, smelled.Status);
        var spawned = world.Apply(new Command("c2", Resolve.WorldAuthor, "edit", null,
            Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "spawn").With("template", "horse").With("overrides",
                Value.Map.Empty.With("name", "mare").With("location", "e1").With("support", "e1")
                    .With("pos", Value.Map.Empty.With("x", 0L).With("y", -200L))))));
        Assert.Equal(Status.Ok, spawned.Status);
        var mare = world.CurrentSnapshot().Entities.Values.Single(entity => entity.Name == "mare").Id;
        var view = new ActorWorld(world, mare);
        var castor = view.Observe().Entities.Single(entity => entity.Name == "castor");

        Assert.Equal(ActorAlias.Of(mare, Castor), castor.Id);
        Assert.Contains(castor.Senses, sense => sense == "smell");
    }

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Pipeline.Result Author(Value.Map edit) =>
        Pipeline.Apply(Built(), Registry, VerbRegistry.All, new Command("c1", Resolve.WorldAuthor, "edit", edit.GetValueOrDefault("target").AsText(), Args: Value.Map.Empty.With("edit", edit)));
}
