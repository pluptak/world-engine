using System.Globalization;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Geometry answers over two snapshots, from src/engine/geometry.ts run on the same inputs: every entity's
// elevation and position, slides, walk stops, gap stops, occupants and push-aside destinations. "lab" is the
// lab-run world; "moved" is the bottle world with the human moved onto the table, so occupants exist.
public class GeometryTests
{
    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    [Theory]
    [InlineData("geometry-lab.snapshot.json", "geometry-lab.expected.json")]
    [InlineData("geometry-moved.snapshot.json", "geometry-moved.expected.json")]
    public void Geometry_matches_TypeScript(string snapshotFile, string expectedFile)
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture(snapshotFile));
        var expected = JsonNode.Parse(ReadFixture(expectedFile))!;
        var ids = snapshot.Entities.Keys.OrderBy(key => key, StringComparer.Ordinal).ToList();
        var positioned = ids.Where(id => Geometry.EffectivePos(snapshot, id) is not null).ToList();

        var result = new Dictionary<string, object?>
        {
            ["elevation"] = ids.ToDictionary(id => id, id => Geometry.Elevation(snapshot, Registry, id), StringComparer.Ordinal),
            ["effective_pos"] = ids.ToDictionary(id => id, id => Geometry.EffectivePos(snapshot, id), StringComparer.Ordinal),
            ["sweep"] = Sweeps(snapshot, ids),
            ["walk"] = Walks(snapshot, ids),
            ["gap"] = Gaps(snapshot, ids, positioned),
            ["occupants"] = ids.ToDictionary(id => id, id => Geometry.OccupantsIn(snapshot, Registry, id), StringComparer.Ordinal),
            ["push"] = Pushes(snapshot, positioned),
        };

        Meaning.Same(expected, WorldJson.Write(result));
    }

    private static Dictionary<string, object?> Sweeps(Snapshot snapshot, List<string> ids)
    {
        var sweeps = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var id in ids)
        {
            foreach (var direction in new[] { "+x", "-x", "+y", "-y" })
            {
                var slide = Geometry.Slide(snapshot, Registry, id, direction, 40, _ => false);
                sweeps[$"{id} {direction}"] = new Dictionary<string, object?>
                {
                    ["distance"] = slide.Distance,
                    ["obstacle"] = slide.Obstacle,
                };
            }
        }
        return sweeps;
    }

    private static Dictionary<string, object?> Walks(Snapshot snapshot, List<string> ids)
    {
        var targets = new List<(long X, long Y)> { (0, 0), (200, 0), (-150, 50), (300, -300), (-40, 20) };
        var walks = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var id in ids)
        {
            var at = Geometry.EffectivePos(snapshot, id);
            var all = at is null
                ? targets
                : targets.Append((at.X + 10, at.Y)).Append((at.X, at.Y - 25)).ToList();
            foreach (var (x, y) in all)
            {
                foreach (var arriving in new[] { false, true })
                {
                    var key = $"{id} {Text(x)},{Text(y)}{(arriving ? " arriving" : "")}";
                    walks[key] = WalkValue(Geometry.WalkStopFor(snapshot, Registry, id, new Pos(x, y), arriving));
                }
            }
        }
        return walks;
    }

    private static Dictionary<string, object?> Gaps(Snapshot snapshot, List<string> ids, List<string> positioned)
    {
        var gaps = new Dictionary<string, object?>(StringComparer.Ordinal);
        var things = ids.Where((_, index) => index % 3 == 0).ToList();
        var pairs = positioned.Take(6).ToList();
        foreach (var thing in things)
        {
            foreach (var from in pairs)
            {
                foreach (var to in pairs)
                {
                    gaps[$"{thing} {from} {to}"] = GapValue(Geometry.GapStopFor(snapshot, Registry, thing, from, to));
                }
            }
        }
        return gaps;
    }

    private static Dictionary<string, object?> Pushes(Snapshot snapshot, List<string> positioned)
    {
        var pushes = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var gate in positioned)
        {
            foreach (var occupant in Geometry.OccupantsIn(snapshot, Registry, gate))
            {
                pushes[$"{gate} {occupant}"] = Geometry.PushAsideDestination(snapshot, Registry, gate, occupant);
            }
        }
        return pushes;
    }

    private static object? WalkValue(Geometry.WalkStop? stop) => stop switch
    {
        null => null,
        Geometry.OutOfBounds => new Dictionary<string, object?> { ["reason"] = "out_of_bounds" },
        Geometry.Blocked blocked => new Dictionary<string, object?> { ["reason"] = "blocked", ["with"] = blocked.With },
        _ => throw new InvalidOperationException("Unknown walk stop"),
    };

    private static object? GapValue(Geometry.GapStop? stop) => stop is null
        ? null
        : new Dictionary<string, object?>
        {
            ["with"] = stop.With,
            ["size_cm"] = stop.SizeCm,
            ["gap_cm"] = stop.GapCm,
        };

    private static string Text(long value) => value.ToString(CultureInfo.InvariantCulture);

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
