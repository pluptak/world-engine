using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Sockets (`docs/sockets.md`): a severed part filled again, by its own limb or an installable
// template. The surgeon is e2, the patient e3, as the builder numbers the scene.
public class SocketTests : IDisposable
{
    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
          { "id": "surgeon", "template": "human", "overrides": { "name": "surgeon", "location": "room", "support": "room", "pos": { "x": 0, "y": 0 } } },
          { "id": "patient", "template": "human", "overrides": { "name": "patient", "location": "room", "support": "room", "pos": { "x": 50, "y": 0 } } },
          { "id": "arm", "template": "robo_arm_l", "overrides": { "name": "arm", "location": "room", "contained_in": "surgeon", "in_part": "hand_r" } }
        ]
        """;

    private const string Surgeon = "e2";
    private const string Patient = "e3";
    private const string Arm = "e4";

    // The frozen set plus the installable arm, which the frozen set never had (`templates/robo_arm_l.json`,
    // copied under Fixtures).
    private static IReadOnlyDictionary<string, Template> Registry { get; } = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates"), "*.json")
            .Concat(Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "socket-templates"), "*.json"))
            .Select(file => (Path.GetFileName(file), File.ReadAllText(file)))));

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["edit"] = EditVerb.Edit,
        ["attack"] = AttackVerb.Attack,
        ["take"] = TakeVerb.Take,
        ["install"] = SocketVerbs.Install,
        ["extract"] = SocketVerbs.Extract,
    };

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "socket-" + Guid.NewGuid().ToString("N"));

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
    public void Set_part_with_a_fitting_installed_names_the_install()
    {
        var severed = Sever(Patient);

        var installed = Pipeline.Apply(severed, Registry, Verbs, SetPart(Patient, "arm_l", 0, "detached", installed: "robo_arm_l"));

        Assert.Equal(Status.Ok, installed.Status);
        Assert.Equal("robo_arm_l", installed.Snapshot.Entities[Patient].Parts["arm_l"].Installed);
        Assert.Equal(50L, Capacities.Of(installed.Snapshot, Registry, Patient, "manipulation"));
    }

    [Fact]
    public void Set_part_with_an_unfitting_installed_is_refused()
    {
        var severed = Sever(Patient);

        var installed = Pipeline.Apply(severed, Registry, Verbs, SetPart(Patient, "arm_l", 0, "detached", installed: "stone"));

        Assert.Equal(Status.Refused, installed.Status);
        Assert.Equal(Code.DoesNotFit, installed.ReasonCode);
    }

    [Fact]
    public void Set_part_with_an_unknown_installed_is_invalid()
    {
        var severed = Sever(Patient);

        var installed = Pipeline.Apply(severed, Registry, Verbs, SetPart(Patient, "arm_l", 0, "detached", installed: "nope"));

        Assert.Equal(Status.Invalid, installed.Status);
        Assert.Equal(Code.UnknownTemplate, installed.ReasonCode);
    }

    [Fact]
    public void Severing_an_installed_arm_spawns_the_installed_template()
    {
        var severed = Sever(Patient);
        var installed = Pipeline.Apply(severed, Registry, Verbs, SetPart(Patient, "arm_l", 100, "intact", installed: "robo_arm_l"));
        Assert.Equal(Status.Ok, installed.Status);

        var snapshot = installed.Snapshot;
        for (var index = 0; index < 3; index++)
        {
            var struck = Pipeline.Apply(snapshot, Registry, Verbs, new Command($"a{index}", Surgeon, "attack", $"{Patient}.arm_l"));
            Assert.Equal(Status.Ok, struck.Status);
            snapshot = struck.Snapshot;
        }

        var body = snapshot.Entities[Patient];
        Assert.Equal(PartStatus.Detached, PartStates.Effective(Registry["human"], body, "arm_l")!.Status);
        var spawned = snapshot.Entities.Values.Where(entity =>
            entity.DetachedFrom == new DetachedFrom(Patient, "arm_l")).ToList();
        Assert.Equal(2, spawned.Count);
        Assert.Equal("robo_arm_l", spawned.Single(entity => entity.Template == "robo_arm_l").Template);
        Assert.Equal(50L, Capacities.Of(snapshot, Registry, Patient, "manipulation"));
    }

    [Fact]
    public void Installing_the_robo_arm_reads_90_and_names_the_install()
    {
        var severed = Sever(Patient);

        var installed = Pipeline.Apply(severed, Registry, Verbs, Install("i1", Surgeon, Patient, "arm_l", Arm));

        Assert.Equal(Status.Ok, installed.Status);
        Assert.Equal(90L, Capacities.Of(installed.Snapshot, Registry, Patient, "manipulation"));
        Assert.Equal("robo_arm_l", installed.Snapshot.Entities[Patient].Parts["arm_l"].Installed);
        Assert.False(installed.Snapshot.Entities.ContainsKey(Arm));
        var consequence = installed.Events.Single(@event => @event.Type == EventType.Installed);
        Assert.Equal(Patient, consequence.Entity);
        Assert.Equal("arm_l", consequence.Data.GetValueOrDefault("part")!.AsText());
        Assert.Equal("robo_arm_l", consequence.Data.GetValueOrDefault("template")!.AsText());
    }

    [Fact]
    public void Extracting_the_robo_arm_spawns_it_at_the_bodys_feet()
    {
        var installed = Pipeline.Apply(Sever(Patient), Registry, Verbs, Install("i1", Surgeon, Patient, "arm_l", Arm)).Snapshot;

        var extracted = Pipeline.Apply(installed, Registry, Verbs, Extract("x1", Surgeon, Patient, "arm_l"));

        Assert.Equal(Status.Ok, extracted.Status);
        var body = extracted.Snapshot.Entities[Patient];
        Assert.Equal(PartStatus.Detached, body.Parts["arm_l"].Status);
        Assert.Null(body.Parts["arm_l"].Installed);
        Assert.Equal(50L, Capacities.Of(extracted.Snapshot, Registry, Patient, "manipulation"));
        var consequence = extracted.Events.Single(@event => @event.Type == EventType.Extracted);
        var implantId = consequence.Data.GetValueOrDefault("entity")!.AsText()!;
        Assert.Equal("arm_l", consequence.Data.GetValueOrDefault("part")!.AsText());
        var implant = extracted.Snapshot.Entities[implantId];
        Assert.Equal("robo_arm_l", implant.Template);
        Assert.Equal("e1", implant.Support);
        Assert.Equal("e1", implant.Location);
        Assert.Equal(new Pos(50, 0), implant.Pos);
        Assert.Equal(new DetachedFrom(Patient, "arm_l"), implant.DetachedFrom);
        Assert.Empty(implant.Parts);
    }

    [Fact]
    public void Reattaching_the_severed_limb_restores_what_severing_took()
    {
        var bruised = Pipeline.Apply(Built(), Registry, Verbs, new Command("b1", Surgeon, "attack", $"{Patient}.hand_l"));
        Assert.Equal(Status.Ok, bruised.Status);
        var snapshot = SeverFrom(bruised.Snapshot, Patient);
        var limb = snapshot.Entities.Values.Single(entity =>
            entity.Template == "human.arm_l" && entity.DetachedFrom == new DetachedFrom(Patient, "arm_l"));
        var taken = Pipeline.Apply(snapshot, Registry, Verbs, new Command("t1", Surgeon, "take", limb.Id));
        Assert.Equal(Status.Ok, taken.Status);

        var installed = Pipeline.Apply(taken.Snapshot, Registry, Verbs, Install("i1", Surgeon, Patient, "arm_l", limb.Id));

        Assert.Equal(Status.Ok, installed.Status);
        var body = installed.Snapshot.Entities[Patient];
        Assert.Null(body.Parts.GetValueOrDefault("arm_l")?.Installed);
        Assert.Equal(new PartState(60, PartStatus.Damaged), body.Parts["hand_l"]);
        Assert.Equal(100L, Capacities.Structural(installed.Snapshot, Registry, Patient, "manipulation"));
        Assert.False(installed.Snapshot.Entities.ContainsKey(limb.Id));
    }

    [Fact]
    public void Installing_into_the_wrong_socket_is_refused()
    {
        var snapshot = SeverFrom(Sever(Patient), Patient, "arm_r");

        var installed = Pipeline.Apply(snapshot, Registry, Verbs, Install("i1", Surgeon, Patient, "arm_r", Arm));

        Assert.Equal(Status.Refused, installed.Status);
        Assert.Equal(Code.DoesNotFit, installed.ReasonCode);
    }

    [Fact]
    public void Installing_into_an_attached_part_is_refused()
    {
        var installed = Pipeline.Apply(Built(), Registry, Verbs, Install("i1", Surgeon, Patient, "arm_r", Arm));

        Assert.Equal(Status.Refused, installed.Status);
        Assert.Equal(Code.SocketOccupied, installed.ReasonCode);
    }

    [Fact]
    public void Extracting_with_nothing_installed_is_refused()
    {
        var extracted = Pipeline.Apply(Built(), Registry, Verbs, Extract("x1", Surgeon, Patient, "arm_r"));

        Assert.Equal(Status.Refused, extracted.Status);
        Assert.Equal(Code.NothingInstalled, extracted.ReasonCode);
    }

    [Fact]
    public void A_surgeon_may_operate_on_its_own_body()
    {
        var snapshot = SeverFrom(Built(), Surgeon);

        var installed = Pipeline.Apply(snapshot, Registry, Verbs, Install("i1", Surgeon, Surgeon, "arm_l", Arm));

        Assert.Equal(Status.Ok, installed.Status);
        Assert.Equal(90L, Capacities.Of(installed.Snapshot, Registry, Surgeon, "manipulation"));
    }

    [Fact]
    public void A_store_world_folds_an_install_alike()
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry);
        var severed = Sever(Patient);
        var expected = Pipeline.Apply(severed, Registry, Verbs, Install("i1", Surgeon, Patient, "arm_l", Arm));

        WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
        var world = StoreWorld.Open(scratch);
        for (var index = 0; index < 3; index++)
        {
            var struck = world.Beat([new Command($"s{index}", Surgeon, "attack", $"{Patient}.arm_l")]);
            Assert.Equal(Status.Ok, struck[0].Status);
        }
        var installed = world.Beat([Install("i1", Surgeon, Patient, "arm_l", Arm)]);

        Assert.Equal(Status.Ok, installed[0].Status);
        Assert.Equal(WorldJson.Write(expected.Snapshot), WorldJson.Write(world.CurrentSnapshot()));
        Assert.True(world.Verify().Ok);
    }

    private static Command Install(string id, string actor, string target, string part, string item) =>
        new(id, actor, "install", target, Args: Value.Map.Empty.With("part", part).With("item", item));

    private static Command Extract(string id, string actor, string target, string part) =>
        new(id, actor, "extract", target, Args: Value.Map.Empty.With("part", part));

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Snapshot Sever(string patient) => SeverFrom(Built(), patient);

    private static Snapshot SeverFrom(Snapshot snapshot, string patient, string part = "arm_l")
    {
        for (var index = 0; index < 3; index++)
        {
            var struck = Pipeline.Apply(snapshot, Registry, Verbs, new Command($"s{index}", Surgeon, "attack", $"{patient}.{part}"));
            Assert.Equal(Status.Ok, struck.Status);
            snapshot = struck.Snapshot;
        }
        Assert.Equal(PartStatus.Detached, PartStates.Effective(Registry["human"], snapshot.Entities[patient], part)!.Status);
        return snapshot;
    }

    private static Command SetPart(string target, string part, long integrity, string status, string? installed = null) =>
        new("e-set", Resolve.WorldAuthor, "edit", target, Args: Value.Map.Empty.With("edit", SetPartEdit(part, integrity, status, target, installed)));

    private static Value.Map SetPartEdit(string part, long integrity, string status, string target, string? installed = null)
    {
        var state = Value.Map.Empty.With("integrity", integrity).With("status", status);
        if (installed is not null)
        {
            state = state.With("installed", installed);
        }
        return Value.Map.Empty.With("kind", "set_part").With("target", target).With("part", part).With("state", state);
    }
}
