using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The read of a world's files (src/store/file-store.ts readers) over a world the TypeScript store wrote: a directory with an accepted
// command, a refused one, an edit and another accepted command (Fixtures/store-world, from scratchpad/gen/store-read.mjs). Each answer is
// compared with what the TypeScript readers said of the same files (Fixtures/store-read.expected.json).
public class StoreReadTests : IDisposable
{
    private static readonly string Fixture = Path.Combine(AppContext.BaseDirectory, "Fixtures", "store-world");
    private static readonly JsonObject Expected = (JsonObject)JsonNode.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "store-read.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storeread-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(scratch, recursive: true);
        }
        catch (IOException)
        {
            // A file a failed test left open is the test's own leftover.
        }
    }

    private static string Canonical<T>(T value) => CanonicalJson.Serialize(JsonNode.Parse(WorldJson.Write(value)));

    [Fact]
    public void The_world_is_recognised()
    {
        Assert.Equal(Expected["exists"]!.GetValue<bool>(), WorldFiles.Exists(Fixture));
        Assert.Equal(Expected["holds"]!.GetValue<bool>(), WorldFiles.HoldsAny(Fixture));
    }

    [Fact]
    public void The_templates_are_the_set_the_world_was_made_with()
    {
        var registry = WorldFiles.ReadTemplates(Fixture);
        var expectedIds = Expected["templates"]!.AsArray().Select(id => id!.GetValue<string>()).ToList();

        Assert.Equal(expectedIds, registry.Keys.Order(StringComparer.Ordinal).ToList());
    }

    [Fact]
    public void The_snapshot_is_the_one_the_TypeScript_store_reads()
    {
        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(Fixture, WorldFiles.CurrentSnapshot));

        Assert.Equal(CanonicalJson.Serialize(Expected["snapshot"]), Canonical(snapshot));
        Assert.Equal(Expected["snapshot"]!["templates_hash"]!.GetValue<string>(), snapshot.TemplatesHash);
    }

    [Fact]
    public void The_head_names_the_sizes_and_counts_the_files_have()
    {
        var head = WorldFiles.ReadHead(Fixture)!;
        var expected = Expected["head"]!.AsObject();

        Assert.Equal(expected["log_bytes"]!.GetValue<long>(), head.LogBytes);
        Assert.Equal(expected["events_bytes"]!.GetValue<long>(), head.EventsBytes);
        Assert.Equal(expected["log_entries"]!.GetValue<long>(), head.LogEntries);
        Assert.Equal(expected["ok_entries"]!.GetValue<long>(), head.OkEntries);
        Assert.Equal(expected["templates_hash"]!.GetValue<string>(), head.TemplatesHash);
        Assert.Equal(expected["deltas_bytes"]?.GetValue<long>(), head.DeltasBytes);
        Assert.Equal(expected["rounds_closed"]?.GetValue<long>(), head.RoundsClosed);
        Assert.Equal(expected["snapshot_version"]?.GetValue<long>(), head.SnapshotVersion);
        Assert.Equal(expected["snapshot_log_bytes"]?.GetValue<long>(), head.SnapshotLogBytes);
    }

    [Fact]
    public void The_log_holds_every_submission_refused_ones_included_in_order()
    {
        var log = WorldFiles.ReadLog(Fixture);
        var expected = Expected["log"]!.AsArray();

        Assert.Equal(expected.Count, log.Count);
        for (var index = 0; index < log.Count; index++)
        {
            Assert.Equal(CanonicalJson.Serialize(expected[index]), Canonical(log[index]));
        }
        Assert.Equal(["ok", "refused", "ok", "ok"], log.Select(entry => entry.Status.ToString().ToLowerInvariant()));
    }

    [Fact]
    public void The_events_and_deltas_are_read_in_file_order()
    {
        var events = WorldFiles.ReadEvents(Fixture);
        var deltas = WorldFiles.ReadDeltas(Fixture);

        Assert.Equal(CanonicalJson.Serialize(Expected["events"]), CanonicalJson.Serialize(new JsonArray(events.Select(e => (JsonNode?)JsonNode.Parse(WorldJson.Write(e))).ToArray())));
        Assert.Equal(CanonicalJson.Serialize(Expected["deltas"]), CanonicalJson.Serialize(new JsonArray(deltas.Select(d => (JsonNode?)JsonNode.Parse(WorldJson.Write(d))).ToArray())));
    }

    [Fact]
    public void The_name_map_is_read_as_the_world_gave_it()
    {
        var ids = WorldFiles.ReadIds(Fixture);

        Assert.Equal(Expected["ids"]!.AsObject().Select(pair => pair.Key).Order(StringComparer.Ordinal), ids.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(Expected["ids"]!["ann"]!.GetValue<string>(), ids["ann"]);
    }

    [Fact]
    public void A_directory_with_no_world_is_no_such_world()
    {
        Directory.CreateDirectory(scratch);

        var error = Assert.Throws<WorldError>(() => WorldFiles.ReadTemplates(scratch));

        Assert.Equal("no_such_world", error.Code);
    }

    [Fact]
    public void A_world_of_another_schema_is_refused_not_read()
    {
        CopyWorld();
        File.WriteAllText(Path.Combine(scratch, WorldFiles.Format), "{\"schema_version\":4}");

        var error = Assert.Throws<WorldError>(() => WorldFiles.ReadEvents(scratch));

        Assert.Equal("unsupported_schema", error.Code);
    }

    [Fact]
    public void A_last_log_line_without_its_newline_is_a_write_under_way_and_is_left_out()
    {
        CopyWorld();
        File.AppendAllText(Path.Combine(scratch, WorldFiles.Log), "{\"based_on_version\":0,\"version\"");

        Assert.Equal(4, WorldFiles.ReadLog(scratch).Count);
    }

    private void CopyWorld()
    {
        Directory.CreateDirectory(scratch);
        foreach (var file in Directory.GetFiles(Fixture))
        {
            File.Copy(file, Path.Combine(scratch, Path.GetFileName(file)));
        }
    }
}
