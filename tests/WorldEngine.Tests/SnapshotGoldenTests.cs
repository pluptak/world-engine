using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// A snapshot field the model does not know is an error, never a value silently dropped on the way through (WorldJson). That
// snapshots round-trip byte for byte is what every golden that writes one already checks.
public class SnapshotGoldenTests
{
    [Fact]
    public void Unknown_snapshot_field_is_refused_not_dropped()
    {
        var golden = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "bottle.snapshot.json"));
        var withField = golden.Replace("\"tick\":", "\"not_a_field\":[],\"tick\":");

        Assert.Throws<FormatException>(() => WorldJson.Read<Snapshot>(withField));
    }
}
