using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// Lines of a world the TypeScript engine wrote (commands run through `npm run world`): each must read as its
// typed record and be written back byte for byte.
public class LogRecordsTests
{
    [Fact]
    public void Log_lines_round_trip_as_attempts()
    {
        foreach (var line in Lines("sample-log.jsonl"))
        {
            var attempt = WorldJson.Read<Attempt>(line);

            Assert.Equal(line, WorldJson.Write(attempt));
        }
    }

    [Fact]
    public void Event_lines_round_trip_as_world_events()
    {
        foreach (var line in Lines("sample-events.jsonl"))
        {
            var worldEvent = WorldJson.Read<WorldEvent>(line);

            Assert.Equal(line, WorldJson.Write(worldEvent));
        }
    }

    [Fact]
    public void Delta_lines_round_trip_as_deltas()
    {
        foreach (var line in Lines("sample-deltas.jsonl"))
        {
            var delta = WorldJson.Read<Delta>(line);

            Assert.Equal(line, WorldJson.Write(delta));
        }
    }

    [Fact]
    public void An_invalid_attempt_keeps_its_status_and_reason_code()
    {
        var attempts = Lines("sample-log.jsonl").Select(WorldJson.Read<Attempt>).ToList();

        var invalid = Assert.Single(attempts, attempt => attempt.Status == Status.Invalid);
        Assert.Equal("invalid_args", invalid.ReasonCode);
        Assert.Contains(attempts, attempt => attempt.Status == Status.Unresolved);
    }

    private static IEnumerable<string> Lines(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name))
            .Split('\n', StringSplitOptions.RemoveEmptyEntries);
}
