using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// A blind body sees nothing and a deaf one hears nothing (`docs/senses.md`), while both still act and their capacities read as before.
// One lit room: the blind human e2, the deaf human e3, a speaker e4 and a stone e5, as the builder numbers them.
public class BlindDeafTests
{
    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
          { "id": "blind", "template": "human", "overrides": { "name": "blind", "location": "room", "support": "room", "pos": { "x": -200, "y": 0 }, "props": { "blind": true } } },
          { "id": "deaf", "template": "human", "overrides": { "name": "deaf", "location": "room", "support": "room", "pos": { "x": 0, "y": 0 }, "props": { "deaf": true } } },
          { "id": "speaker", "template": "human", "overrides": { "name": "speaker", "location": "room", "support": "room", "pos": { "x": 100, "y": 0 } } },
          { "id": "stone", "template": "stone", "overrides": { "name": "stone", "location": "room", "support": "room", "pos": { "x": 200, "y": 0 } } }
        ]
        """;

    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["say"] = SayVerb.Say,
        ["wait"] = WaitVerb.Wait,
    };

    [Fact]
    public void A_blind_body_sees_nothing_and_a_sighted_one_sees_the_stone()
    {
        var snapshot = Lit();

        var blind = Perception.Perceive(snapshot, Registry, "e2", "e5", Sense.Sight);
        Assert.Equal(Truth.False, blind.Value);
        Assert.Equal(Code.Blind, blind.BasisCode);

        var sighted = Perception.Perceive(snapshot, Registry, "e4", "e5", Sense.Sight);
        Assert.Equal(Truth.True, sighted.Value);
        Assert.Equal(100L, Capacities.Of(snapshot, Registry, "e2", "sight"));
    }

    [Fact]
    public void A_deaf_body_hears_no_speech_and_a_hearing_one_does()
    {
        var said = Pipeline.Apply(Lit(), Registry, Verbs, new Command("c1", "e4", "say", Args: Value.Map.Empty.With("utterance", "hello")));
        Assert.Equal(Status.Ok, said.Status);
        var speech = said.Events[0].EventId;

        var deaf = EventPerception.Perceive(said.Snapshot, Registry, said.Events, "e3", speech, Sense.Hearing);
        Assert.Equal(Truth.False, deaf.Value);
        Assert.Equal(Code.Deaf, deaf.BasisCode);

        var hearing = EventPerception.Perceive(said.Snapshot, Registry, said.Events, "e2", speech, Sense.Hearing);
        Assert.Equal(Truth.True, hearing.Value);
    }

    [Fact]
    public void A_blind_body_still_acts()
    {
        var waited = Pipeline.Apply(Lit(), Registry, Verbs, new Command("c1", "e2", "wait", Args: Value.Map.Empty.With("ticks", 1)));

        Assert.Equal(Status.Ok, waited.Status);
    }

    private static Snapshot Lit() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;
}
