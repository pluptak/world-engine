using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Command provenance (`docs/actor-view.md`): an actor view names the agent that sent its command, and the world takes it only from the
// body's controller. One lab: a terminal that controls an arm, and a human who does not.
public class ProvenanceTests : IDisposable
{
    private const string Scene = """
        [
          { "id": "lab", "template": "room", "overrides": { "name": "lab", "props": { "lit": true } } },
          { "id": "generator", "template": "generator", "overrides": { "name": "generator", "location": "lab", "support": "lab", "pos": { "x": 300, "y": 300 } } },
          { "id": "terminal", "template": "terminal", "overrides": { "name": "terminal", "location": "lab", "support": "lab", "pos": { "x": 0, "y": 0 }, "props": { "powered_by": "generator" } } },
          { "id": "arm", "template": "arm", "overrides": { "name": "arm", "location": "lab", "support": "lab", "pos": { "x": -200, "y": 0 }, "props": { "powered_by": "generator", "controlled_by": "terminal" } } },
          { "id": "bob", "template": "human", "overrides": { "name": "bob", "location": "lab", "support": "lab", "pos": { "x": 200, "y": 0 } } },
          { "id": "doorstop", "template": "stone", "overrides": { "name": "doorstop", "location": "lab", "support": "lab", "pos": { "x": 300, "y": 0 } } }
        ]
        """;

    // The ids the builder gives the scene's entities, in order: the room, the generator, the terminal, the arm and the human.
    private const string Terminal = "e3";
    private const string Arm = "e4";
    private const string Bob = "e5";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "provenance-" + Guid.NewGuid().ToString("N"));

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
    public void The_controller_sends_for_its_body_and_the_log_says_so()
    {
        var world = Open();

        var verdict = new ActorWorld(world, Arm, via: Terminal).Apply(new ActorCommand("c1", "wait", Args: Value.Map.Empty.With("ticks", 1)));

        Assert.Equal(Status.Ok, verdict.Status);
        var logged = File.ReadAllLines(Path.Combine(scratch, "log.jsonl")).Last();
        Assert.Equal(Terminal, JsonNode.Parse(logged)!["command"]!["via"]!.GetValue<string>());
        Assert.True(world.Verify().Ok);
    }

    [Fact]
    public void A_command_sent_for_another_agent_is_refused_not_controller()
    {
        var world = Open();

        var verdict = new ActorWorld(world, Arm, via: Bob).Check(new ActorCommand("c1", "wait", Args: Value.Map.Empty.With("ticks", 1)));

        Assert.Equal(Status.Refused, verdict.Status);
        Assert.Equal(Code.NotController, verdict.ReasonCode);
    }

    [Theory]
    [InlineData("nope", Code.NoSuchActor)]
    [InlineData("e6", Code.NotAnAgent)]
    public void A_via_that_is_no_agent_is_invalid(string via, Code code)
    {
        var verdict = new ActorWorld(Open(), Arm, via: via).Check(new ActorCommand("c1", "wait", Args: Value.Map.Empty.With("ticks", 1)));

        Assert.Equal(Status.Invalid, verdict.Status);
        Assert.Equal(code, verdict.ReasonCode);
    }

    [Fact]
    public void A_command_without_via_is_as_before()
    {
        var world = Open();

        var verdict = new ActorWorld(world, Arm).Apply(new ActorCommand("c1", "wait", Args: Value.Map.Empty.With("ticks", 1)));

        Assert.Equal(Status.Ok, verdict.Status);
        Assert.DoesNotContain("via", File.ReadAllLines(Path.Combine(scratch, "log.jsonl")).Last());
    }

    private StoreWorld Open()
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry);
        WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
        return StoreWorld.Open(scratch);
    }
}
