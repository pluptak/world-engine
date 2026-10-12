using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// Snapshots written by the TypeScript engine (npm run world -- init, then snapshot.json). The bytes must
// come back unchanged: that is the proof the port reads and writes the same state.
public class SnapshotGoldenTests
{
    [Theory]
    [InlineData("bottle.snapshot.json")]
    [InlineData("camp.snapshot.json")]
    [InlineData("lab-run.snapshot.json")]
    public void Generic_JSON_round_trips_byte_for_byte(string fixture)
    {
        var golden = ReadFixture(fixture);

        Assert.Equal(golden, WorldJson.Canonicalize(golden));
    }

    [Fact]
    public void Typed_snapshot_round_trips_byte_for_byte()
    {
        var golden = ReadFixture("bottle.snapshot.json");

        var snapshot = WorldJson.Read<Snapshot>(golden);

        Assert.Equal(golden, WorldJson.Write(snapshot));
        Assert.Equal(5, snapshot.Entities.Count);
        Assert.Equal("bottle", snapshot.Entities["e3"].Name);
    }

    [Fact]
    public void Unknown_snapshot_field_is_refused_not_dropped()
    {
        var golden = ReadFixture("bottle.snapshot.json");
        var withSchedule = golden.Replace("\"tick\":", "\"schedule\":[],\"tick\":");

        Assert.ThrowsAny<System.Text.Json.JsonException>(() => WorldJson.Read<Snapshot>(withSchedule));
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
