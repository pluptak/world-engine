using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The read-only helpers (src/engine/catalog.ts, capabilities.ts, compare.ts, pending.ts) on the shipped templates and a small
// schedule: each result compared with TypeScript's (Fixtures/readonly-golden.expected.json, from scratchpad/gen/readonly-golden.mjs).
public class ReadOnlyGoldenTests
{
    private static JsonNode Golden { get; } = JsonNode.Parse(ReadFixture("readonly-golden.expected.json"))!;

    [Fact]
    public void Catalog_matches_TypeScript()
    {
        var entries = Catalog.Of(TestTemplates.RepoRegistry);

        Assert.True(
            CanonicalJson.Serialize(Golden["catalog"]) == WorldJson.Write(entries),
            "the catalog differs from TypeScript's");
    }

    [Fact]
    public void Capabilities_match_TypeScript()
    {
        var capabilities = Golden["capabilities"]!;

        Assert.True(
            CanonicalJson.Serialize(capabilities["engine"]) == WorldJson.Write(new Dictionary<string, object>
            {
                ["relations"] = Capabilities.Relations,
                ["senses"] = Capabilities.Senses,
                ["computed_properties"] = Capabilities.ComputedProperties,
            }),
            "the engine's capabilities differ from TypeScript's");

        foreach (var row in capabilities["uncomputable"]!.AsArray())
        {
            var coverage = WorldJson.Read<Coverage>(row!["coverage"]!.ToJsonString());
            Assert.True(
                CanonicalJson.Serialize(row["result"]) == WorldJson.Write(Capabilities.Uncomputable(coverage)),
                $"uncomputable for {row["coverage"]!.ToJsonString()} differs from TypeScript's");
        }
    }

    [Fact]
    public void Order_ops_match_TypeScript()
    {
        foreach (var row in Golden["compare"]!.AsArray())
        {
            var holds = OrderOps.Holds(
                row!["op"]!.GetValue<string>(),
                row["have"]!.GetValue<double>(),
                row["want"]!.GetValue<double>());

            Assert.Equal(row["result"]!.GetValue<bool>(), holds);
        }
    }

    [Fact]
    public void Schedule_reads_and_writes_match_TypeScript()
    {
        var schedule = Golden["schedule"]!;
        var snapshot = WorldJson.Read<Snapshot>(schedule["snapshot"]!.ToJsonString());

        foreach (var row in schedule["scheduled"]!.AsArray())
        {
            var filter = row!["filter"]!;
            var found = Schedule.Scheduled(
                snapshot,
                filter["kind"]?.GetValue<string>(),
                filter["entity"]?.GetValue<string>(),
                filter["until_tick"]?.GetValue<long>());

            Assert.True(
                CanonicalJson.Serialize(row["result"]) == WorldJson.Write(found),
                $"scheduled for {filter.ToJsonString()} differs from TypeScript's");
        }

        var cause = WorldJson.Read<ScheduledCause>(schedule["cause"]!.ToJsonString());
        var added = new Working(snapshot, "c1");
        Schedule.Add(added, cause);
        Assert.True(CanonicalJson.Serialize(schedule["added"]) == WorldJson.Write(added.Snapshot), "withCause differs from TypeScript's");

        var withoutEntity = snapshot with
        {
            Entities = snapshot.Entities
                .Where(pair => pair.Key != schedule["removed"]!.GetValue<string>())
                .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
        };
        var pruned = new Working(withoutEntity, "c1");
        Schedule.Prune(pruned);
        Assert.True(CanonicalJson.Serialize(schedule["pruned"]) == WorldJson.Write(pruned.Snapshot), "pruneSchedule differs from TypeScript's");

        var emptied = new Working(snapshot, "c1");
        Schedule.Replace(emptied, []);
        Assert.True(CanonicalJson.Serialize(schedule["emptied"]) == WorldJson.Write(emptied.Snapshot), "an emptied schedule differs from TypeScript's");
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
