using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Scheduled outcomes (`docs/sockets.md`): an install of an attempt template waits for its tick, when the dice decide it. The
// surgeon is e2, the patient e3, the even-odds arm e4, the sure arm e5 and the hall e6, as the builder numbers the scene.
public class OutcomeTests : IDisposable
{
    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
          { "id": "surgeon", "template": "human", "overrides": { "name": "surgeon", "location": "room", "support": "room", "pos": { "x": 0, "y": 0 } } },
          { "id": "patient", "template": "human", "overrides": { "name": "patient", "location": "room", "support": "room", "pos": { "x": 50, "y": 0 } } },
          { "id": "arm", "template": "robo_arm_l", "overrides": { "name": "arm", "location": "room", "contained_in": "surgeon", "in_part": "hand_r" } },
          { "id": "sure", "template": "sure_arm_l", "overrides": { "name": "sure", "location": "room", "contained_in": "surgeon", "in_part": "hand_l" } },
          { "id": "hall", "template": "room", "overrides": { "name": "hall", "props": { "lit": true } } }
        ]
        """;

    private const string Surgeon = "e2";
    private const string Patient = "e3";
    private const string Arm = "e4";
    private const string Sure = "e5";
    private const string Hall = "e6";

    // Seeds whose first roll falls under 50 and over it.
    private const long Lucky = 7;
    private const long Unlucky = 1;

    // The frozen set plus two attempt arms: `robo_arm_l` at even odds, five ticks, 30 damage on failure, and `sure_arm_l` at 100.
    private static IReadOnlyDictionary<string, Template> Registry { get; } = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates"), "*.json")
            .Concat(Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "outcome-templates"), "*.json"))
            .Select(file => (Path.GetFileName(file), File.ReadAllText(file)))));

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "outcome-" + Guid.NewGuid().ToString("N"));

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
    public void An_attempt_schedules_its_outcome_and_leaves_the_item_in_hand()
    {
        var world = Severed(Lucky);

        var installed = world.Apply(Install("i1", Arm));

        Assert.Equal(Status.Ok, installed.Status);
        Assert.Equal(Surgeon, world.CurrentSnapshot().Entities[Arm].ContainedIn);
        Assert.Equal(PartStatus.Detached, world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Status);
        var scheduled = installed.Events.Single(@event => @event.Type == EventType.OutcomeScheduled);
        Assert.Equal(Patient, scheduled.Entity);
        Assert.Equal(Arm, scheduled.Data.GetValueOrDefault("item")!.AsText());
        var cause = Assert.IsType<OutcomeCause>(world.Scheduled(CauseKind.Outcome).Single());
        Assert.Equal(new OutcomeCause(installed.Snapshot.Tick - 1 + 5, Patient, scheduled.EventId, "arm_l", Arm, Surgeon), cause);
    }

    [Fact]
    public void A_lucky_roll_installs_the_arm_at_its_tick_and_the_trace_reads_the_attempt()
    {
        var world = Severed(Lucky);
        world.Apply(Install("i1", Arm));

        var waited = world.Apply(Advance("w1", 5));

        Assert.Equal(Status.Ok, waited.Status);
        Assert.Contains(waited.Events, @event => @event.Type == EventType.OutcomeSucceeded);
        Assert.Equal("robo_arm_l", world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Installed);
        Assert.False(world.CurrentSnapshot().Entities.ContainsKey(Arm));
        Assert.Empty(world.Scheduled(CauseKind.Outcome));
        Assert.Equal(
            ["install", EventType.OutcomeScheduled, EventType.OutcomeSucceeded],
            world.TraceOf(null, Patient, "parts").Select(@event => @event.Type));
    }

    [Fact]
    public void An_unlucky_roll_fails_hurts_the_patient_and_leaves_the_arm_in_hand()
    {
        var world = Severed(Unlucky);
        world.Apply(Install("i1", Arm));
        var before = world.CurrentSnapshot().Entities[Patient].Integrity;

        var waited = world.Apply(Advance("w1", 5));

        var failed = waited.Events.Single(@event => @event.Type == EventType.OutcomeFailed);
        Assert.Equal("roll", failed.Data.GetValueOrDefault("reason")!.AsText());
        var hurt = waited.Events.Single(@event => @event.CauseId == failed.EventId);
        Assert.Equal(EventType.Damaged, hurt.Type);
        // The stump bleeds over the same ticks: the failure takes 30 from whatever the blow before it left.
        var left = waited.Events.TakeWhile(@event => @event != hurt)
            .Where(@event => @event.Type == EventType.Damaged && @event.Entity == Patient)
            .Select(@event => @event.Data.GetValueOrDefault("integrity")!.AsInt()!.Value)
            .DefaultIfEmpty(before)
            .Last();
        Assert.Equal(left - 30, hurt.Data.GetValueOrDefault("integrity")!.AsInt());
        Assert.Equal(PartStatus.Detached, world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Status);
        Assert.Equal(Surgeon, world.CurrentSnapshot().Entities[Arm].ContainedIn);
    }

    [Fact]
    public void An_attempt_at_50_resolves_alike_on_a_memory_world_a_store_world_and_a_replay()
    {
        foreach (var seed in new[] { Lucky, Unlucky })
        {
            var memory = Severed(seed);
            memory.Apply(Install("i1", Arm));
            memory.Apply(Advance("w1", 5));

            var dir = Path.Combine(scratch, seed.ToString());
            var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry);
            WorldBuilder.Create(dir, made.Snapshot, Registry, made.Ids);
            var store = StoreWorld.Open(dir);
            Assert.Equal(Status.Ok, store.Edit(SetSeed(seed)).Status);
            foreach (var strike in Strikes())
            {
                Assert.Equal(Status.Ok, store.Apply(strike).Status);
            }
            Assert.Equal(Status.Ok, store.Apply(Install("i1", Arm)).Status);
            Assert.Equal(Status.Ok, store.Apply(Advance("w1", 5)).Status);

            Assert.Equal(WorldJson.Write(memory.CurrentSnapshot()), WorldJson.Write(store.CurrentSnapshot()));
            Assert.Equal(WorldJson.Write(memory.CurrentSnapshot()), WorldJson.Write(WorldReplay.ReplayFold(dir, Registry).Snapshot));
            Assert.True(store.Verify().Ok);
        }
    }

    [Fact]
    public void A_sure_attempt_needs_no_seed_and_an_even_one_does()
    {
        var world = Severed(seed: null);

        var even = world.Apply(Install("i1", Arm));
        Assert.Equal(Status.Refused, even.Status);
        Assert.Equal(Code.NoSeed, even.ReasonCode);

        var sure = world.Apply(Install("i2", Sure));
        Assert.Equal(Status.Ok, sure.Status);
        world.Apply(Advance("w1", 5));
        Assert.Equal("sure_arm_l", world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Installed);
    }

    [Fact]
    public void An_attack_during_the_pending_ticks_lands_before_the_outcome()
    {
        var world = Severed(Lucky);
        var installed = world.Apply(Install("i1", Arm));

        var struck = world.Apply(new Command("a1", Surgeon, "attack", Patient));
        var waited = world.Apply(Advance("w1", 5));

        Assert.Equal(Status.Ok, struck.Status);
        var blow = struck.Events.First(@event => @event.Type == EventType.Damaged);
        var success = waited.Events.Single(@event => @event.Type == EventType.OutcomeSucceeded);
        Assert.Equal(
            ["install", EventType.OutcomeScheduled, EventType.OutcomeSucceeded],
            world.TraceOf(success.EventId, null, null).Select(@event => @event.Type));
        Assert.Equal(["attack", EventType.Damaged], world.TraceOf(blow.EventId, null, null).Select(@event => @event.Type));
        Assert.True(EventNumber(blow) < EventNumber(success));
        Assert.True(EventNumber(installed.Events[0]) < EventNumber(blow));
    }

    [Fact]
    public void The_implant_left_in_another_room_fails_out_of_reach()
    {
        var world = Severed(Lucky);
        world.Apply(Install("i1", Arm));
        var placed = world.Edit(Value.Map.Empty
            .With("kind", "place")
            .With("target", Arm)
            .With("support", Hall)
            .With("pos", Value.Map.Empty.With("x", 0L).With("y", 0L))
            .With("clear", new Value.List([new Value.Text("contained_in"), new Value.Text("in_part")])));
        Assert.Equal(Status.Ok, placed.Status);

        var waited = world.Apply(Advance("w1", 5));

        var failed = waited.Events.Single(@event => @event.Type == EventType.OutcomeFailed);
        Assert.Equal("out_of_reach", failed.Data.GetValueOrDefault("reason")!.AsText());
        Assert.DoesNotContain(waited.Events, @event => @event.CauseId == failed.EventId);
        Assert.Equal(Hall, world.CurrentSnapshot().Entities[Arm].Location);
    }

    [Fact]
    public void A_stump_filled_before_its_tick_fails_socket_occupied()
    {
        var world = Severed(Lucky);
        world.Apply(Install("i1", Arm));
        Assert.Equal(Status.Ok, world.Apply(Install("i2", Sure)).Status);

        var waited = world.Apply(Advance("w1", 5));

        Assert.Equal("robo_arm_l", world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Installed);
        var failed = waited.Events.Single(@event => @event.Type == EventType.OutcomeFailed);
        Assert.Equal(Sure, failed.Data.GetValueOrDefault("item")!.AsText());
        Assert.Equal("socket_occupied", failed.Data.GetValueOrDefault("reason")!.AsText());
        Assert.Equal(Surgeon, world.CurrentSnapshot().Entities[Sure].ContainedIn);
    }

    [Fact]
    public void The_implant_removed_by_the_author_prunes_the_cause_with_no_event()
    {
        var world = Severed(Lucky);
        world.Apply(Install("i1", Arm));

        var removed = world.Edit(Value.Map.Empty.With("kind", "remove").With("target", Arm));
        var waited = world.Apply(Advance("w1", 5));

        Assert.Equal(Status.Ok, removed.Status);
        Assert.Empty(world.Scheduled(CauseKind.Outcome));
        Assert.DoesNotContain(waited.Events, @event => @event.Type is EventType.OutcomeSucceeded or EventType.OutcomeFailed);
        Assert.Equal(PartStatus.Detached, world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Status);
    }

    [Fact]
    public void A_schedule_naming_a_missing_item_is_refused()
    {
        var world = Severed(Lucky);
        world.Apply(Install("i1", Arm));
        var snapshot = world.CurrentSnapshot();
        var dangling = snapshot with { Schedule = [.. snapshot.Schedule!.Select(cause => cause is OutcomeCause outcome ? outcome with { Item = "e99" } : cause)] };

        var issues = SnapshotValidation.Validate(dangling, Registry);

        Assert.Contains(issues, issue => issue.Code == Code.ScheduleDangling);
    }

    // A world with the patient's left arm severed, seeded when a seed is given.
    private static MemoryWorld Severed(long? seed)
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;
        var world = new MemoryWorld(made, Registry, made.TemplatesHash);
        if (seed is { } given)
        {
            Assert.Equal(Status.Ok, world.Edit(SetSeed(given)).Status);
        }
        foreach (var strike in Strikes())
        {
            Assert.Equal(Status.Ok, world.Apply(strike).Status);
        }
        Assert.Equal(PartStatus.Detached, world.CurrentSnapshot().Entities[Patient].Parts["arm_l"].Status);
        return world;
    }

    private static IEnumerable<Command> Strikes() =>
        Enumerable.Range(0, 3).Select(index => new Command($"s{index}", Surgeon, "attack", $"{Patient}.arm_l"));

    private static Value.Map SetSeed(long seed) => Value.Map.Empty.With("kind", "set_seed").With("seed", seed);

    private static Command Install(string id, string item) =>
        new(id, Surgeon, "install", Patient, Args: Value.Map.Empty.With("part", "arm_l").With("item", item));

    private static Command Advance(string id, long ticks) =>
        new(id, Resolve.WorldAuthor, "advance", Args: Value.Map.Empty.With("ticks", ticks));

    private static long EventNumber(WorldEvent @event) => long.Parse(@event.EventId.TrimStart('e', 'v'));
}
