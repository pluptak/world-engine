using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The human in the bottle world, with parts damaged, detached and destroyed and modifiers set. The expected
// answers come from src/engine/parts.ts and capacity.ts run on the same snapshot (Fixtures/parts.expected.json).
public class PartsAndCapacityTests
{
    private static readonly string[] CapacityNames = ["manipulation", "sight", "speech", "hearing", "moving", "touch", "nope"];

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static JsonNode Golden { get; } =
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "parts.expected.json")))!;

    [Theory]
    [InlineData("damaged")]
    [InlineData("unconscious")]
    public void Capacities_and_part_states_match_TypeScript(string label)
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture($"{label}.snapshot.json"));
        var entity = snapshot.Entities["e4"];
        var template = Registry[entity.Template];
        var partNames = template.Parts.Select(part => part.Name).Append("nope").ToList();

        var result = new Dictionary<string, object?>
        {
            ["capacity"] = CapacityNames.ToDictionary(name => name, name => Capacities.Of(snapshot, Registry, "e4", name)),
            ["structural_capacity"] = CapacityNames.ToDictionary(name => name, name => Capacities.Structural(snapshot, Registry, "e4", name)),
            ["capacities"] = Capacities.All(snapshot, Registry, "e4"),
            ["structural_capacities"] = Capacities.StructuralAll(snapshot, Registry, "e4"),
            ["part_state"] = partNames.ToDictionary(name => name, name => PartStates.State(template, entity, name)),
            ["effective_part"] = partNames.ToDictionary(name => name, name => PartStates.Effective(template, entity, name)),
        };

        Meaning.Same(Golden[label], WorldJson.Write(result));
    }

    [Fact]
    public void Default_part_detection_matches_TypeScript()
    {
        var human = Registry["human"];
        var result = human.Parts.ToDictionary(
            decl => decl.Name,
            decl => new Dictionary<string, bool>
            {
                ["at_default"] = PartStates.IsDefault(decl, new PartState(decl.MaxIntegrity, PartStatus.Intact)),
                ["below_default"] = PartStates.IsDefault(decl, new PartState(decl.MaxIntegrity - 1, PartStatus.Intact)),
                ["damaged_at_max"] = PartStates.IsDefault(decl, new PartState(decl.MaxIntegrity, PartStatus.Damaged)),
            });

        Meaning.Same(Golden["is_default"], WorldJson.Write(result));
    }

    [Fact]
    public void Setting_parts_to_default_drops_their_entries_as_TypeScript_does()
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture("damaged.snapshot.json"));
        var changes = WorldJson.Read<Dictionary<string, PartState>>(Golden["changes"]!.ToJsonString());

        var result = PartStates.With(Registry["human"], snapshot.Entities["e4"].Parts, changes);

        Meaning.Same(Golden["with_parts"], WorldJson.Write(result));
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));

    [Fact]
    public void An_installed_part_contributes_from_its_installed_template()
    {
        var human = Registry["human"];
        var robo = new Template(
            "robo_arm_l",
            human.SizeCm,
            human.MassG,
            [
                new PartDecl("arm_l", null, new Dictionary<string, long>(), true, 100),
                .. human.Parts.Where(part => part.Name is "hand_l" or "thumb_l").Select(part => part with
                {
                    Contributes = new Dictionary<string, long>(part.Name == "hand_l"
                        ? new Dictionary<string, long> { ["manipulation"] = 40 }
                        : new Dictionary<string, long>()),
                }),
            ],
            Value.Map.Empty,
            [],
            new Dictionary<string, long>(),
            Fits: "human.arm_l");
        var registry = new Dictionary<string, Template>(StringComparer.Ordinal)
        {
            ["human"] = human,
            ["robo_arm_l"] = robo,
        };
        var entity = new Entity(
            Id: "e1",
            Template: "human",
            Name: "patient",
            Aliases: [],
            Location: null,
            Support: null,
            ContainedIn: null,
            InPart: null,
            ConcealedBy: null,
            Pos: null,
            DetachedFrom: null,
            Integrity: 100,
            Status: EntityStatus.Intact,
            Parts: new Dictionary<string, PartState>(StringComparer.Ordinal)
            {
                ["arm_l"] = new PartState(100, PartStatus.Intact, Installed: "robo_arm_l"),
            },
            Residue: new Dictionary<string, long>(),
            Modifiers: [],
            Props: Value.Map.Empty,
            Traits: null);
        var snapshot = new Snapshot(
            Version: 1,
            Tick: 0,
            NextSeq: 2,
            TemplatesHash: "x",
            Coverage: new Coverage([], [], []),
            Entities: new Dictionary<string, Entity>(StringComparer.Ordinal) { ["e1"] = entity },
            Rng: null);

        Assert.Equal(90L, Capacities.Structural(snapshot, registry, "e1", "manipulation"));
        Assert.Equal(90L, Capacities.Of(snapshot, registry, "e1", "manipulation"));
    }
}
