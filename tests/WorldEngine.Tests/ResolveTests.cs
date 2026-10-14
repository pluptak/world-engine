using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;
using static WorldEngine.Core.Engine.Resolve;

namespace WorldEngine.Tests;

// Target resolution answers from src/engine/resolve.ts run on the same snapshot: the author's names (ids and
// `entity.part`, which need no access checks) match the golden files, and an agent's names are checked with
// stubbed access, so these tests do not depend on `addressable`.
public class ResolveTests
{
    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static readonly Access Everything = new(_ => true, _ => false);
    private static readonly Access Nothing = new(_ => false, _ => false);

    [Theory]
    [InlineData("bottle.snapshot.json", "resolve-bottle.expected.json")]
    [InlineData("geometry-lab.snapshot.json", "resolve-lab.expected.json")]
    public void The_author_resolves_as_TypeScript_does(string snapshotFile, string expectedFile)
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture(snapshotFile));
        var expected = JsonNode.Parse(ReadFixture(expectedFile))!;

        // The author has no entity of its own, so resolution never reaches for access: no access is passed.
        var result = expected.AsArray().Select(node =>
        {
            var text = node!["text"]!.GetValue<string>();
            return new Dictionary<string, object?>
            {
                ["text"] = text,
                ["result"] = Shape(ResolveTarget(snapshot, Registry, WorldAuthor, text)),
            };
        }).ToList();

        Meaning.Same(expected, WorldJson.Write(result));
    }

    [Fact]
    public void An_agent_names_what_it_can_address_by_name_and_alias()
    {
        var snapshot = Bottle();

        Assert.Equal(WorldJson.Write(Found("e3", null)), Written(ResolveTarget(snapshot, Registry, "e4", "bottle", Everything)));
        Assert.Equal(WorldJson.Write(Found("e2", null)), Written(ResolveTarget(snapshot, Registry, "e4", "TABLE", Everything)));
        Assert.Equal(WorldJson.Write(Found("e3", null)), Written(ResolveTarget(snapshot, Registry, "e4", "e3", Everything)));
    }

    [Fact]
    public void An_agent_cannot_name_what_it_cannot_address()
    {
        var snapshot = Bottle();

        Assert.Equal(WorldJson.Write(Missing), Written(ResolveTarget(snapshot, Registry, "e4", "bottle", Nothing)));
        Assert.Equal(WorldJson.Write(Missing), Written(ResolveTarget(snapshot, Registry, "e4", "e3", Nothing)));
    }

    [Fact]
    public void Two_things_with_one_name_are_ambiguous_and_listed_in_order()
    {
        var snapshot = Bottle();
        var twin = snapshot.Entities["e3"] with { Id = "e6" };
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal) { ["e6"] = twin };

        Assert.Equal(
            WorldJson.Write(Choice(["e3", "e6"])),
            Written(ResolveTarget(snapshot with { Entities = entities }, Registry, "e4", "bottle", Everything)));
    }

    [Fact]
    public void An_abstract_mark_is_never_named_by_an_agent()
    {
        var snapshot = Bottle();
        var mark = new Entity(
            "e7", "anchor", "mark", [], "e1", null, null, null, null, null, null, 100, EntityStatus.Intact,
            new Dictionary<string, PartState>(), new Dictionary<string, long>(), [], Value.Map.Empty, null);
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal) { ["e7"] = mark };
        var withMark = snapshot with { Entities = entities };

        Assert.True(IsAbstract(Registry, mark));
        Assert.Equal(WorldJson.Write(Missing), Written(ResolveTarget(withMark, Registry, "e4", "mark", Everything)));
        Assert.Equal(WorldJson.Write(Missing), Written(ResolveTarget(withMark, Registry, "e4", "e7", Everything)));
    }

    [Fact]
    public void A_part_resolves_when_its_entity_is_addressable()
    {
        var snapshot = Bottle();

        Assert.Equal(WorldJson.Write(Found("e4", "torso")), Written(ResolveTarget(snapshot, Registry, "e4", "e4.torso", Everything)));
        Assert.Equal(WorldJson.Write(Missing), Written(ResolveTarget(snapshot, Registry, "e4", "e4.torso", Nothing)));
        Assert.Equal(WorldJson.Write(Missing), Written(ResolveTarget(snapshot, Registry, "e4", "e3.nosuchpart", Everything)));
    }

    [Fact]
    public void Doors_are_known_by_their_from_and_to_props()
    {
        var snapshot = Bottle();
        var door = snapshot.Entities["e5"] with { Props = Value.Map.Empty.With("from", "e1").With("to", "e8") };

        Assert.True(IsDoor(door));
        Assert.False(IsDoor(snapshot.Entities["e5"]));
        Assert.False(IsDoor(null));
    }

    private static Snapshot Bottle() => WorldJson.Read<Snapshot>(ReadFixture("bottle.snapshot.json"));

    private static Dictionary<string, object?> Found(string entity, string? part) =>
        new()
        {
            ["status"] = "resolved",
            ["target"] = new Dictionary<string, object?>
            {
                ["entity_id"] = entity,
                ["part"] = part,
                ["address"] = part is null ? entity : $"{entity}.{part}",
            },
        };

    private static Dictionary<string, object?> Missing { get; } = new() { ["status"] = "unresolved" };

    private static Dictionary<string, object?> Choice(IEnumerable<string> candidates) =>
        new() { ["status"] = "ambiguous", ["candidates"] = candidates.ToList() };

    internal static Dictionary<string, object?> Shape(TargetResolution resolution) => resolution switch
    {
        Resolved resolved => Found(resolved.Target.EntityId, resolved.Target.Part),
        Ambiguous ambiguous => Choice(ambiguous.Candidates),
        Unresolved => Missing,
        _ => throw new InvalidOperationException("Unknown resolution"),
    };

    private static string Written(TargetResolution resolution) => WorldJson.Write(Shape(resolution));

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
