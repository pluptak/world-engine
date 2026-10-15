using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// A walk toward a thing stops where the footprints touch, and one already touching is already_there (docs/verbs-moving.md).
public class MoveTowardTests
{
    private const string Scene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "ann", "template": "human", "overrides": { "name": "ann", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 0 } } },
          { "id": "bob", "template": "human", "overrides": { "name": "bob", "location": "hall", "support": "hall", "pos": { "x": 300, "y": 0 } } },
          { "id": "table", "template": "table", "overrides": { "name": "table", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 300 } } },
          { "id": "key", "template": "key", "overrides": { "name": "key", "location": "hall", "support": "table" } },
          { "id": "coin", "template": "key", "overrides": { "name": "coin", "location": "hall", "contained_in": "ann" } }
        ]
        """;

    private const string Ann = "e2";
    private const string Bob = "e3";
    private const string Key = "e5";
    private const string Coin = "e6";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    private static Snapshot World() => WorldBuilder.Snapshot(ValueJson.Parse(Scene)!, Registry).Snapshot;

    private static Pipeline.Result Toward(Snapshot snapshot, string target) =>
        Pipeline.Apply(snapshot, Registry, VerbRegistry.All, new Command("c1", Ann, "move", Args: Value.Map.Empty.With("toward", target)));

    [Fact]
    public void A_walk_toward_someone_stops_where_the_footprints_touch_and_then_is_already_there()
    {
        var walked = Toward(World(), Bob);

        Assert.Equal(Status.Ok, walked.Status);
        Assert.Equal(new Pos(255, 0), walked.Snapshot.Entities[Ann].Pos);
        var again = Toward(walked.Snapshot, Bob);
        Assert.Equal(Status.Refused, again.Status);
        Assert.Equal(Code.AlreadyThere, again.ReasonCode);
    }

    [Fact]
    public void A_thing_on_a_table_is_approached_by_the_table()
    {
        var walked = Toward(World(), Key);

        Assert.Equal(Status.Ok, walked.Status);
        Assert.Equal(new Pos(0, 255), walked.Snapshot.Entities[Ann].Pos);
    }

    [Fact]
    public void What_the_walker_holds_is_already_there()
    {
        var held = Toward(World(), Coin);

        Assert.Equal(Status.Refused, held.Status);
        Assert.Equal(Code.AlreadyThere, held.ReasonCode);
    }
}
