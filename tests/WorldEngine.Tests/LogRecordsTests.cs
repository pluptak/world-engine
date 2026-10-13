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
        var log = Lines("sample-log.jsonl").ToList();
        Assert.NotEmpty(log);
        foreach (var line in log)
        {
            var attempt = WorldJson.Read<Attempt>(line);

            Assert.Equal(line, WorldJson.Write(attempt));
        }
    }

    [Fact]
    public void Event_lines_round_trip_as_world_events()
    {
        var events = Lines("sample-events.jsonl").ToList();
        Assert.NotEmpty(events);
        foreach (var line in events)
        {
            var worldEvent = WorldJson.Read<WorldEvent>(line);

            Assert.Equal(line, WorldJson.Write(worldEvent));
        }
    }

    [Fact]
    public void Delta_lines_round_trip_as_deltas()
    {
        var deltas = Lines("sample-deltas.jsonl").ToList();
        Assert.NotEmpty(deltas);
        foreach (var line in deltas)
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
