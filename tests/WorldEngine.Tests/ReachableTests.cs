using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// `reachable`, in a fact and in an inspection, is the rule the verbs apply: a doorway with no position is reached from
// anywhere in a room it joins, a positioned one in its own room only within `reach_cm` (docs/perception.md). A deliberate
// deviation from TypeScript, whose `reachable` read the ordinary rule alone and so called a door out of reach that
// `close` then shut.
public class ReachableTests
{
    private const string Scene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "yard", "template": "room", "overrides": { "name": "yard", "props": { "lit": true } } },
          { "id": "gate", "template": "door", "overrides": { "name": "gate", "props": { "open": true, "from": "hall", "to": "yard" } } },
          { "id": "hatch", "template": "door", "overrides": { "name": "hatch", "location": "hall", "support": "hall", "pos": { "x": 900, "y": 0 }, "props": { "open": true, "from": "hall", "to": "yard" } } },
          { "id": "ann", "template": "human", "overrides": { "name": "ann", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 0 } } }
        ]
        """;

    private const string Gate = "e3";
    private const string Hatch = "e4";
    private const string Ann = "e5";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    private static Snapshot World() => WorldBuilder.Snapshot(ValueJson.Parse(Scene)!, Registry, WorldBuilder.DefaultCoverage).Snapshot;

    private static Pipeline.Result Close(string target) =>
        Pipeline.Apply(World(), Registry, VerbRegistry.All, new Command("c1", Ann, "close", target));

    [Fact]
    public void A_door_with_no_position_is_reachable_where_close_reaches_it()
    {
        Assert.Equal(Truth.True, Queries.Fact(World(), Registry, Ann, "reachable", Gate).Value);
        Assert.True(Projection.InspectEntity(World(), Registry, [], Ann, Gate)!.Reachable);
        Assert.Equal(Status.Ok, Close(Gate).Status);
    }

    [Fact]
    public void A_positioned_door_across_its_own_room_is_out_of_reach_as_close_finds_it()
    {
        Assert.Equal(Truth.False, Queries.Fact(World(), Registry, Ann, "reachable", Hatch).Value);
        Assert.False(Projection.InspectEntity(World(), Registry, [], Ann, Hatch)!.Reachable);
        Assert.Equal(Status.Refused, Close(Hatch).Status);
    }
}
