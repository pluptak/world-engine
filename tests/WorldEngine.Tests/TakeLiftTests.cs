using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Lifting a body (docs/verbs-holding.md, docs/carrying.md): an agent that can move resists, and a thing heavier than one hand's
// share of the lifter's limit takes both hands.
public class TakeLiftTests
{
    private const string Scene = """
        [
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } },
          { "id": "ann", "template": "human", "overrides": { "name": "ann", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 0 } } },
          { "id": "bob", "template": "human", "overrides": { "name": "bob", "location": "hall", "support": "hall", "pos": { "x": 60, "y": 0 } } },
          { "id": "cid", "template": "human", "overrides": { "name": "cid", "location": "hall", "support": "hall", "pos": { "x": 0, "y": 60 }, "props": { "unconscious": true } } },
          { "id": "dee", "template": "human", "overrides": { "name": "dee", "location": "hall", "support": "hall", "pos": { "x": -60, "y": 0 }, "props": { "asleep": true } } },
          { "id": "key", "template": "key", "overrides": { "name": "key", "location": "hall", "contained_in": "bob" } }
        ]
        """;

    private const string Ann = "e2";
    private const string Bob = "e3";
    private const string Cid = "e4";
    private const string Dee = "e5";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "templates")));

    private static Snapshot World() => WorldBuilder.Snapshot(ValueJson.Parse(Scene)!, Registry).Snapshot;

    private static Pipeline.Result Take(string actor, string target) =>
        Pipeline.Apply(World(), Registry, VerbRegistry.All, new Command("c1", actor, "take", target));

    [Fact]
    public void An_agent_that_can_move_resists_being_lifted()
    {
        var result = Take(Ann, Bob);

        Assert.Equal(Status.Refused, result.Status);
        Assert.Equal(Code.Resists, result.ReasonCode);
    }

    [Fact]
    public void A_body_that_cannot_resist_is_lifted_with_both_hands()
    {
        var result = Take(Ann, Cid);

        Assert.Equal(Status.Ok, result.Status);
        var held = Carry.HeldInParts(result.Snapshot, Registry, Ann).Single();
        Assert.Equal((Cid, 2L), (held.Id, held.Hands));
        Assert.Equal(Status.Ok, Take(Ann, Dee).Status);
    }

    [Fact]
    public void One_free_hand_cannot_lift_a_body()
    {
        var result = Take(Bob, Cid);

        Assert.Equal(Status.Refused, result.Status);
        Assert.Equal(Code.HandsFull, result.ReasonCode);
        Assert.Equal("{\"free\":1,\"need\":2}", WorldJson.Write(result.ReasonData));
    }
}
