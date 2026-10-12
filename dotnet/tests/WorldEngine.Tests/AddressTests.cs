using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The reach measure, the loop check and the gap refusal of src/engine/verbs/address.ts, every ordered pair of entities
// in five worlds: the two rich worlds, the geometry lab, and the lab with a barrier at a 20 cm and a 60 cm gap. The
// expected answers come from the TypeScript functions on the same snapshots (Fixtures/address.expected.json).
public class AddressTests
{
    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static JsonNode Golden { get; } =
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "address.expected.json")))!;

    [Theory]
    [InlineData("rich-dark")]
    [InlineData("rich-away")]
    [InlineData("geometry-lab")]
    [InlineData("geometry-barrier-20")]
    [InlineData("geometry-barrier-60")]
    public void Reach_loop_and_gap_answers_match_TypeScript(string world)
    {
        var snapshot = WorldJson.Read<Snapshot>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", $"{world}.snapshot.json")));
        var ids = snapshot.Entities.Keys.Order(StringComparer.Ordinal).ToList();
        var expected = Golden[world]!;

        var reach = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var actor in ids)
        {
            foreach (var target in ids)
            {
                var measure = Address.ReachData(snapshot, actor, target);
                reach[$"{actor}>{target}"] = new Dictionary<string, object?>
                {
                    ["value"] = measure is null ? null : new Dictionary<string, object?>
                    {
                        ["distance_cm"] = measure.DistanceCm,
                        ["reach_cm"] = measure.ReachCm,
                    },
                };
            }
        }
        Assert.True(CanonicalJson.Serialize(expected["reach"]) == WorldJson.Write(reach), $"{world}: reach differs from TypeScript's");

        var loop = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var item in ids)
        {
            foreach (var destination in ids)
            {
                loop[$"{item}>{destination}"] = new Dictionary<string, object?> { ["value"] = Address.WouldLoop(snapshot, item, destination) };
            }
        }
        Assert.True(CanonicalJson.Serialize(expected["loop"]) == WorldJson.Write(loop), $"{world}: loop differs from TypeScript's");

        var gap = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var thing in ids)
        {
            foreach (var from in ids)
            {
                foreach (var to in ids)
                {
                    var stop = Geometry.GapStopFor(snapshot, Registry, thing, from, to);
                    gap[$"{thing}:{from}>{to}"] = new Dictionary<string, object?>
                    {
                        ["value"] = stop is null ? null : new Dictionary<string, object?>
                        {
                            ["with"] = stop.With,
                            ["size_cm"] = stop.SizeCm,
                            ["gap_cm"] = stop.GapCm,
                        },
                    };
                }
            }
        }
        Assert.True(CanonicalJson.Serialize(expected["gap"]) == WorldJson.Write(gap), $"{world}: gap refusal differs from TypeScript's");
    }
}
