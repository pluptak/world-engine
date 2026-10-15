using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// What `scenarios/disguise.json` (sean, castor who would wear his face, and a guard, in a lit hall) cannot say today: each line of
// `docs/limits-disguise.md` is one test. The scene is in code, with the ids the builder gives it (the hall, sean, castor and the guard are e1
// to e4), on the shipped set the scene is built with.
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

    // A body is shown by its own alias, name and template whatever it wears: the guard tells sean and castor apart by sight alone.
    [Fact]
    public void A_seen_body_is_shown_by_its_own_alias_name_and_template()
    {
        var view = new ActorWorld(World(), Guard);
        var castor = view.Inspect(ActorAlias.Of(Guard, Castor));
        var sean = view.Inspect(ActorAlias.Of(Guard, Sean));

        Assert.NotNull(castor);
        Assert.NotNull(sean);
        Assert.NotEqual(castor.Id, sean.Id);
        Assert.Equal("castor", castor.Name);
        Assert.Equal("human", castor.Template);
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
