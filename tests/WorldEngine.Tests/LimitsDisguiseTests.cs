using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// What `scenarios/disguise.json` (sean, castor who would wear his face, and a guard, in a lit hall) cannot say: each line of
// `docs/limits-disguise.md` is one test. The scene is in code, with the ids the builder gives it (the hall, sean, castor and the guard are e1
// to e4), on the shipped set the scene is built with. A seen body is now shown by the face it wears, so the first test wears the
// face and asserts the opposite of the limit it names.
public class LimitsDisguiseTests
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

    // A seen body is shown by the face it wears: with castor wearing sean's face the guard gets one alias for
    // both, named sean.
    [Fact]
    public void A_seen_body_is_shown_by_its_own_alias_name_and_template()
    {
        var world = World();
        var worn = world.Apply(new Command("w1", Resolve.WorldAuthor, "edit", Castor,
            Args: Value.Map.Empty.With("edit", Value.Map.Empty.With("kind", "update_props").With("target", Castor)
                .With("props", Value.Map.Empty.With("appearance", Sean)))));
        Assert.Equal(Status.Ok, worn.Status);

        var view = new ActorWorld(world, Guard);
        var seen = view.Observe().Entities.Where(entity => entity.Name == "sean").ToList();

        Assert.Equal(2, seen.Count);
        Assert.Equal(seen[0].Id, seen[1].Id);
        Assert.Equal(ActorAlias.Of(Guard, Sean), seen[0].Id);
    }

    // A name is given at spawn and never after: no edit makes castor answer to sean's.
    [Fact]
    public void A_name_cannot_be_changed_after_spawn()
    {
        var renamed = Author(Value.Map.Empty.With("kind", "update_props").With("target", Castor).With("props", Value.Map.Empty.With("name", "sean")));

        Assert.Equal(Status.Refused, renamed.Status);
        Assert.Equal(Code.UndeclaredProp, renamed.ReasonCode);
    }

    // A face is no part that moves: a human's head is not detachable, so Sockets cannot carry one face to another body.
    [Fact]
    public void A_face_is_no_part_that_moves()
    {
        Assert.False(Registry["human"].Parts.Single(part => part.Name == "head").Detachable);
    }

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static MemoryWorld World()
    {
        var snapshot = Built();
        return new MemoryWorld(snapshot, Registry, snapshot.TemplatesHash);
    }

    private static Pipeline.Result Author(Value.Map edit) =>
        Pipeline.Apply(Built(), Registry, VerbRegistry.All, new Command("c1", Resolve.WorldAuthor, "edit", edit.GetValueOrDefault("target").AsText(), Args: Value.Map.Empty.With("edit", edit)));
}
