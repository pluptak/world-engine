using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The author's `afflict` edit: a timed modifier on a capacity, expired by the clock as an attack's is. One room, a human and a stone.
public class AfflictTests : IDisposable
{
    // The ids the scene gives its entities, in order: the room, then the human and the stone.
    private const string Pusher = "e2";
    private const string Stone = "e3";

    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room" } },
          { "id": "pusher", "template": "human", "overrides": { "name": "pusher", "location": "room", "support": "room", "pos": { "x": -50, "y": 0 } } },
          { "id": "doorstop", "template": "stone", "overrides": { "name": "doorstop", "location": "room", "support": "room", "pos": { "x": 129, "y": 0 } } }
        ]
        """;

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["edit"] = EditVerb.Edit,
        ["wait"] = WaitVerb.Wait,
    };

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "afflict-" + Guid.NewGuid().ToString("N"));

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
    public void A_lone_affliction_lowers_its_capacity_until_it_expires()
    {
        var snapshot = Built();
        Assert.Equal(100L, Capacities.Of(snapshot, Registry, Pusher, "moving"));

        var afflicted = Apply(snapshot, Afflict(Pusher, "moving", -50, until: 3));

        Assert.Equal(Status.Ok, afflicted.Status);
        Assert.Equal(50L, Capacities.Of(afflicted.Snapshot, Registry, Pusher, "moving"));
        var edited = afflicted.Events.Single(evt => evt.Type == EventType.Edited);
        var changed = afflicted.Events.Single(evt => evt.Type == EventType.CapabilityChanged);
        Assert.Equal(edited.EventId, changed.CauseId);
        Assert.Equal(100L, changed.Data.GetValueOrDefault("from").AsInt());
        Assert.Equal(50L, changed.Data.GetValueOrDefault("to").AsInt());

        var waited = Apply(afflicted.Snapshot, Wait(Pusher, 3));
        Assert.Equal(100L, Capacities.Of(waited.Snapshot, Registry, Pusher, "moving"));
        var expiry = waited.Events.Single(evt => evt.Type == EventType.CapabilityChanged);
        Assert.Equal(3L, expiry.Tick);
        Assert.Equal(edited.EventId, expiry.CauseId);
    }

    [Fact]
    public void Two_afflictions_on_one_capacity_stack()
    {
        var first = Apply(Built(), Afflict(Pusher, "moving", -30, until: 5));
        var second = Apply(first.Snapshot, Afflict(Pusher, "moving", -30, until: 5));

        Assert.Equal(40L, Capacities.Of(second.Snapshot, Registry, Pusher, "moving"));
    }

    [Fact]
    public void Structural_capacity_is_not_afflicted()
    {
        var afflicted = Apply(Built(), Afflict(Pusher, "moving", -50, until: 3));

        Assert.Equal(100L, Capacities.Structural(afflicted.Snapshot, Registry, Pusher, "moving"));
    }

    [Fact]
    public void Refused_or_invalid_afflictions_change_nothing()
    {
        var snapshot = Built();
        var cases = new[]
        {
            (Afflict(Pusher, "nope", -10, until: 3), Status.Refused, Code.UnknownCapacity),
            (Afflict(Pusher, "moving", -10, until: 0), Status.Invalid, Code.InvalidTick),
            (Afflict(Stone, "moving", -10, until: 3), Status.Refused, Code.UnknownCapacity),
            (Afflict(Pusher, "moving", 0, until: 3), Status.Invalid, Code.InvalidArgs),
            (Afflict(Pusher, "moving", 101, until: 3), Status.Invalid, Code.InvalidArgs),
        };

        foreach (var (command, status, code) in cases)
        {
            var result = Apply(snapshot, command);

            Assert.Equal(status, result.Status);
            Assert.Equal(code, result.ReasonCode);
            Assert.Equal(WorldJson.Write(snapshot), WorldJson.Write(result.Snapshot));
        }
    }

    [Fact]
    public void A_store_world_folds_the_same_afflictions()
    {
        var made = WorldBuilder.Snapshot(Values.Of(JsonNode.Parse(Scene))!, Registry);
        var expected = Apply(made.Snapshot, Afflict(Pusher, "moving", -50, until: 3));
        expected = Apply(expected.Snapshot, Wait(Pusher, 3));

        WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
        var world = StoreWorld.Open(scratch);
        Assert.Equal(Status.Ok, world.Edit(AfflictEdit(Pusher, "moving", -50, until: 3)).Status);
        Assert.Equal(Status.Ok, world.Apply(Wait(Pusher, 3)).Status);

        Assert.Equal(WorldJson.Write(expected.Snapshot), WorldJson.Write(world.CurrentSnapshot()));
    }

    private static Snapshot Built() => WorldBuilder.Snapshot(Values.Of(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Pipeline.Result Apply(Snapshot snapshot, Command command) => Pipeline.Apply(snapshot, Registry, Verbs, command);

    private static Command Afflict(string target, string capacity, long amount, long until) =>
        new("e-afflict", Resolve.WorldAuthor, "edit", target, Args: Value.Map.Empty.With("edit", AfflictEdit(target, capacity, amount, until)));

    private static Value.Map AfflictEdit(string target, string capacity, long amount, long until) =>
        Value.Map.Empty
            .With("kind", "afflict")
            .With("target", target)
            .With("capacity", capacity)
            .With("amount", amount)
            .With("until", until);

    private static Command Wait(string actor, long ticks) =>
        new("e-wait", actor, "wait", Args: Value.Map.Empty.With("ticks", ticks));
}
