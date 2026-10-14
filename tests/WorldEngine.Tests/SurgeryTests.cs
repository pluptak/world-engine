using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// A cut opens a part without severing it (`docs/verbs-surgery.md`): the surgeon holds a scalpel, the patient's arm_l is incised and
// bleeds, and nothing else changes. The builder numbers the room e1, the surgeon e2, the patient e3 and the scalpel e4.
public class SurgeryTests : IDisposable
{
    private const string Scene = """
        [
          { "id": "room", "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
          { "id": "surgeon", "template": "human", "overrides": { "name": "surgeon", "location": "room", "support": "room", "pos": { "x": 50, "y": 0 } } },
          { "id": "patient", "template": "human", "overrides": { "name": "patient", "location": "room", "support": "room", "pos": { "x": 100, "y": 0 } } },
          { "id": "scalpel", "template": "scalpel", "overrides": { "name": "scalpel", "location": "room", "contained_in": "surgeon", "in_part": "hand_r" } },
          { "id": "arm", "template": "arm", "overrides": { "name": "arm", "location": "room", "support": "room", "pos": { "x": 75, "y": 0 } } }
        ]
        """;

    private const string Surgeon = "e2";
    private const string Patient = "e3";

    // The TypeScript set plus the scalpel, which TypeScript never had (`templates/scalpel.json`, copied under Fixtures).
    private static IReadOnlyDictionary<string, Template> Registry { get; } = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(
        Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates"), "*.json")
            .Concat(Directory.GetFiles(Path.Combine(AppContext.BaseDirectory, "Fixtures", "surgery-templates"), "*.json"))
            .Select(file => (Path.GetFileName(file), File.ReadAllText(file)))));

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["cut"] = SurgeryVerbs.Cut,
        ["wait"] = WaitVerb.Wait,
    };

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "surgery-" + Guid.NewGuid().ToString("N"));

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
    public void A_cut_incises_the_part_and_starts_a_bleed_that_names_it()
    {
        var cut = Pipeline.Apply(Built(), Registry, Verbs, Cut(Surgeon, Patient, "arm_l"));

        Assert.Equal(Status.Ok, cut.Status);
        var part = PartStates.Effective(Registry["human"], cut.Snapshot.Entities[Patient], "arm_l");
        Assert.Equal(PartStatus.Intact, part!.Status);
        Assert.True(PartStates.State(Registry["human"], cut.Snapshot.Entities[Patient], "arm_l")!.Incised);
        Assert.Equal(100L, Capacities.Of(cut.Snapshot, Registry, Patient, "moving"));
        var bleed = (cut.Snapshot.Schedule ?? []).OfType<BleedCause>().Single();
        Assert.Equal(Patient, bleed.Entity);
        Assert.Equal("arm_l", bleed.Part);
        var root = Assert.Single(cut.Events);
        Assert.Equal("cut", root.Type);
        Assert.Null(root.CauseId);
    }

    [Fact]
    public void A_cut_on_a_body_that_does_not_bleed_only_incises()
    {
        var cut = Pipeline.Apply(Built(), Registry, Verbs, Cut(Surgeon, "e5", "gripper"));

        Assert.Equal(Status.Ok, cut.Status);
        Assert.True(PartStates.State(Registry["arm"], cut.Snapshot.Entities["e5"], "gripper")!.Incised);
        Assert.Empty((cut.Snapshot.Schedule ?? []).OfType<BleedCause>());
    }

    [Fact]
    public void A_cut_with_nothing_to_cut_with_is_refused()
    {
        var cut = Pipeline.Apply(Built(), Registry, Verbs, Cut(Patient, Surgeon, "arm_l"));

        Assert.Equal(Status.Refused, cut.Status);
        Assert.Equal(Code.NoCuttingTool, cut.ReasonCode);
    }

    [Fact]
    public void A_second_cut_on_the_same_part_is_refused()
    {
        var first = Pipeline.Apply(Built(), Registry, Verbs, Cut(Surgeon, Patient, "arm_l"));
        var second = Pipeline.Apply(first.Snapshot, Registry, Verbs, Cut(Surgeon, Patient, "arm_l"));

        Assert.Equal(Status.Refused, second.Status);
        Assert.Equal(Code.AlreadyIncised, second.ReasonCode);
    }

    [Fact]
    public void A_cut_targeting_a_part_address_is_refused()
    {
        var cut = Pipeline.Apply(Built(), Registry, Verbs, new Command("e-cut", Surgeon, "cut", $"{Patient}.arm_l", Args: Value.Map.Empty.With("part", "arm_l")));

        Assert.Equal(Status.Refused, cut.Status);
        Assert.Equal(Code.TargetAttached, cut.ReasonCode);
    }

    [Fact]
    public void The_bleed_runs_its_course_and_ends()
    {
        var cut = Pipeline.Apply(Built(), Registry, Verbs, Cut(Surgeon, Patient, "arm_l"));
        var later = Pipeline.Apply(cut.Snapshot, Registry, Verbs, new Command("e-wait", Surgeon, "wait", Args: Value.Map.Empty.With("ticks", 7L)));

        Assert.Equal(Status.Ok, later.Status);
        Assert.Empty((later.Snapshot.Schedule ?? []).OfType<BleedCause>());
        Assert.Equal(85L, later.Snapshot.Entities[Patient].Integrity);

        var second = Pipeline.Apply(later.Snapshot, Registry, Verbs, Cut(Surgeon, Patient, "arm_l"));

        Assert.Equal(Status.Refused, second.Status);
        Assert.Equal(Code.AlreadyIncised, second.ReasonCode);
    }

    [Fact]
    public void A_store_world_folds_the_cut_alike()
    {
        var made = WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry);
        var expected = Pipeline.Apply(made.Snapshot, Registry, Verbs, Cut(Surgeon, Patient, "arm_l"));

        WorldBuilder.Create(scratch, made.Snapshot, Registry, made.Ids);
        var world = StoreWorld.Open(scratch);
        Assert.Equal(Status.Ok, world.Apply(Cut(Surgeon, Patient, "arm_l")).Status);

        Assert.Equal(WorldJson.Write(expected.Snapshot), WorldJson.Write(world.CurrentSnapshot()));
        Assert.True(world.Verify().Ok);
    }

    private static Snapshot Built() => WorldBuilder.Snapshot(ValueJson.FromNode(JsonNode.Parse(Scene))!, Registry).Snapshot;

    private static Command Cut(string actor, string target, string part) =>
        new("e-cut", actor, "cut", target, Args: Value.Map.Empty.With("part", part));
}
