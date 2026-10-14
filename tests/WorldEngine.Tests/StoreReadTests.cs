using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
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

        Meaning.Same(Expected["snapshot"], Canonical(snapshot));
        Assert.Equal(Expected["snapshot"]!["templates_hash"]!.GetValue<string>(), snapshot.TemplatesHash);
    }

    [Fact]
    public void A_head_with_fractional_sizes_is_refused()
    {
        var dir = Path.Combine(scratch, "world");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "head.json"),
            """{"log_bytes":1.5,"events_bytes":0,"log_entries":1,"ok_entries":1,"templates_hash":"h"}""");

        Assert.Null(WorldFiles.ReadHead(dir));
    }

    [Fact]
    public void A_log_line_with_a_fractional_based_on_version_is_refused()
    {
        const string line = """{"based_on_version":1.5,"version":1,"status":"ok","command":{"command_id":"c1","actor":"e1","verb":"wait","args":{}}}""";

        Assert.Throws<FormatException>(() => WorldFiles.ParseLogLine(line, 1));
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
            Meaning.Same(expected[index], Canonical(log[index]));
        }
        Assert.Equal(["ok", "refused", "ok", "ok", "ok"], log.Select(entry => entry.Status.ToString().ToLowerInvariant()));
    }

    [Fact]
    public void The_events_and_deltas_are_read_in_file_order()
    {
        var events = WorldFiles.ReadEvents(Fixture);
        var deltas = WorldFiles.ReadDeltas(Fixture);

        Meaning.Same(Expected["events"], new JsonArray([.. events.Select(e => (JsonNode?)JsonNode.Parse(WorldJson.Write(e)))]));
        Meaning.Same(Expected["deltas"], new JsonArray([.. deltas.Select(d => (JsonNode?)JsonNode.Parse(WorldJson.Write(d)))]));
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

        Assert.Equal(Code.NoSuchWorld, error.Code);
    }

    [Fact]
    public void A_world_of_another_schema_is_refused_not_read()
    {
        CopyWorld();
        File.WriteAllText(Path.Combine(scratch, WorldFiles.Format), "{\"schema_version\":4}");

        var error = Assert.Throws<WorldError>(() => WorldFiles.ReadEvents(scratch));

        Assert.Equal(Code.UnsupportedSchema, error.Code);
    }

    [Fact]
    public void A_last_log_line_without_its_newline_is_a_write_under_way_and_is_left_out()
    {
        CopyWorld();
        File.AppendAllText(Path.Combine(scratch, WorldFiles.Log), "{\"based_on_version\":0,\"version\"");

        Assert.Equal(Expected["log"]!.AsArray().Count, WorldFiles.ReadLog(scratch).Count);
    }

    [Fact]
    public void The_templates_hash_of_the_resolved_set_is_the_one_the_world_holds()
    {
        var registry = WorldFiles.ReadTemplates(Fixture);

        Assert.Equal(Expected["templates_hash"]!.GetValue<string>(), WorldReplay.HashOf(registry));
    }

    [Fact]
    public void Replaying_the_log_gives_the_snapshot_and_the_events_and_deltas_the_TypeScript_replay_gave()
    {
        var fold = WorldReplay.ReplayFold(Fixture, WorldFiles.ReadTemplates(Fixture));
        var expected = Expected["fold"]!.AsObject();

        Meaning.Same(expected["snapshot"], Canonical(fold.Snapshot));
        Meaning.Same(expected["events"], Canonical(fold.Events));
        Meaning.Same(expected["deltas"], Canonical(fold.Deltas));
        Meaning.Same(Expected["replay"], Canonical(fold.Snapshot));
    }

    [Fact]
    public void A_world_whose_files_agree_is_trusted_at_the_snapshot_the_TypeScript_load_gave()
    {
        var snapshot = WorldReplay.TrustedSnapshot(Fixture, WorldFiles.ReadTemplates(Fixture));

        Assert.NotNull(snapshot);
        Meaning.Same(Expected["load"], Canonical(snapshot));
    }

    [Fact]
    public void A_world_whose_events_file_disagrees_with_its_head_is_not_trusted()
    {
        CopyWorld();
        File.AppendAllText(Path.Combine(scratch, WorldFiles.Events), "\n");

        Assert.Null(WorldReplay.TrustedSnapshot(scratch, WorldFiles.ReadTemplates(scratch)));
    }

    [Fact]
    public void A_different_template_set_is_not_trusted_for_this_world()
    {
        Assert.Null(WorldReplay.TrustedSnapshot(Fixture, TestTemplates.Registry));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void Since_gives_the_deltas_and_events_the_TypeScript_store_gave(long version)
    {
        var (deltas, events) = WorldHistory.Since(Fixture, version, WorldFiles.ReadTemplates(Fixture));
        var expected = Expected["since"]![version.ToString()]!.AsObject();

        Meaning.Same(expected["deltas"], Canonical(deltas));
        Meaning.Same(expected["events"], Canonical(events));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void Attempts_gives_every_submission_from_the_version_the_TypeScript_store_gave(long version)
    {
        var attempts = WorldHistory.Attempts(Fixture, version, WorldFiles.ReadTemplates(Fixture));

        Meaning.Same(Expected["attempts"]![version.ToString()], Canonical(attempts));
    }

    [Fact]
    public void A_version_ahead_of_the_world_or_below_zero_is_refused_as_the_store_refuses_it()
    {
        var registry = WorldFiles.ReadTemplates(Fixture);
        var errors = Expected["errors"]!.AsObject();

        Assert.Equal(errors["since_future"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.Since(Fixture, 5, registry)).Code));
        Assert.Equal(errors["attempts_future"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.Attempts(Fixture, 5, registry)).Code));
        Assert.Equal(errors["since_negative"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.Since(Fixture, -1, registry)).Code));
        Assert.Equal(errors["attempts_negative"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.Attempts(Fixture, -1, registry)).Code));
    }

    [Fact]
    public void Trace_gives_the_chains_the_TypeScript_store_gave()
    {
        var registry = WorldFiles.ReadTemplates(Fixture);
        var traces = Expected["trace"]!.AsObject();
        var eventId = traces["event"]!.AsArray().Last()!["event_id"]!.GetValue<string>();
        var ids = Expected["ids"]!.AsObject();

        Meaning.Same(traces["event"], Canonical(WorldHistory.TraceOf(Fixture, eventId, null, null, registry)));
        Meaning.Same(traces["stone_contained_in"], Canonical(WorldHistory.TraceOf(Fixture, null, ids["stone"]!.GetValue<string>(), "contained_in", registry)));
        Meaning.Same(traces["ann_spawn"], Canonical(WorldHistory.TraceOf(Fixture, null, ids["ann"]!.GetValue<string>(), "entity", registry)));
        Meaning.Same(traces["hall_props"], Canonical(WorldHistory.TraceOf(Fixture, null, ids["hall"]!.GetValue<string>(), "props", registry)));
    }

    [Fact]
    public void Trace_refuses_an_unknown_event_entity_or_field_as_the_store_refuses_it()
    {
        var registry = WorldFiles.ReadTemplates(Fixture);
        var errors = Expected["trace_errors"]!.AsObject();
        var stone = Expected["ids"]!["stone"]!.GetValue<string>();

        Assert.Equal(errors["event"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.TraceOf(Fixture, "ev999", null, null, registry)).Code));
        Assert.Equal(errors["entity"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.TraceOf(Fixture, null, "nobody", "props", registry)).Code));
        Assert.Equal(errors["field"]!.GetValue<string>(), WorldJson.Name(Assert.Throws<WorldError>(() => WorldHistory.TraceOf(Fixture, null, stone, "bogus", registry)).Code));
    }

    [Fact]
    public void Perceive_answers_on_the_stored_world_as_the_TypeScript_store_does()
    {
        var registry = WorldFiles.ReadTemplates(Fixture);
        Assert.NotEmpty(Expected["query"]!.AsArray());
        foreach (var row in Expected["query"]!.AsArray().Select(row => row!.AsObject()))
        {
            var sense = row["sense"]!.GetValue<string>();
            var answer = row["event_id"] is { } eventId
                ? WorldHistory.QueryPerceive(Fixture, Expected["ids"]!["ann"]!.GetValue<string>(), sense, registry, eventId: eventId.GetValue<string>())
                : WorldHistory.QueryPerceive(Fixture, Expected["ids"]!["ann"]!.GetValue<string>(), sense, registry, entity: row["entity"]!.GetValue<string>());
            var actual = new JsonObject { ["value"] = WorldJson.Name(answer.Value), ["basis_code"] = WorldJson.Name(answer.BasisCode) };

            Meaning.Same(row["answer"], actual);
        }
    }

    private static readonly string Checkpointed = Path.Combine(AppContext.BaseDirectory, "Fixtures", "store-checkpoint");

    [Fact]
    public void A_world_written_with_a_checkpoint_per_command_has_the_same_log_and_checkpoints_for_each_one()
    {
        Assert.Equal(4, Directory.GetFiles(Path.Combine(Checkpointed, "checkpoints")).Length);
        foreach (var name in new[] { WorldFiles.Log, WorldFiles.Events, WorldFiles.Deltas })
        {
            Assert.Equal(File.ReadAllBytes(Path.Combine(Fixture, name)), File.ReadAllBytes(Path.Combine(Checkpointed, name)));
        }
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void Since_from_a_checkpoint_gives_the_same_answer_as_from_initial(long version)
    {
        var (deltas, events) = WorldHistory.Since(Checkpointed, version, WorldFiles.ReadTemplates(Checkpointed));
        var expected = Expected["since"]![version.ToString()]!.AsObject();

        Meaning.Same(expected["deltas"], Canonical(deltas));
        Meaning.Same(expected["events"], Canonical(events));
    }

    [Fact]
    public void A_replay_for_a_later_version_starts_from_the_newest_usable_checkpoint()
    {
        var start = WorldCheckpoints.ReplayStart(Checkpointed, WorldFiles.ReadTemplates(Checkpointed), (version, _) => version <= 3);

        Assert.False(start.FromInitial);
        Assert.Equal(3, start.Snapshot.Version);
        Assert.Equal(new long[] { 5 }, start.Entries.Select(entry => (long)entry.Line).ToArray());
    }

    [Fact]
    public void Perceive_from_a_checkpoint_gives_the_same_answers_as_from_initial()
    {
        var registry = WorldFiles.ReadTemplates(Checkpointed);
        Assert.NotEmpty(Expected["query"]!.AsArray());
        foreach (var row in Expected["query"]!.AsArray().Select(row => row!.AsObject()))
        {
            var sense = row["sense"]!.GetValue<string>();
            var answer = row["event_id"] is { } eventId
                ? WorldHistory.QueryPerceive(Checkpointed, Expected["ids"]!["ann"]!.GetValue<string>(), sense, registry, eventId: eventId.GetValue<string>())
                : WorldHistory.QueryPerceive(Checkpointed, Expected["ids"]!["ann"]!.GetValue<string>(), sense, registry, entity: row["entity"]!.GetValue<string>());
            var actual = new JsonObject { ["value"] = WorldJson.Name(answer.Value), ["basis_code"] = WorldJson.Name(answer.BasisCode) };

            Meaning.Same(row["answer"], actual);
        }
    }

    [Fact]
    public void A_corrupt_checkpoint_is_ignored_and_the_answers_do_not_change()
    {
        Directory.CreateDirectory(scratch);
        CopyDirectory(Checkpointed, scratch);
        // The newest checkpoint is replaced with something that is not one; the answer must still be the one from initial.json.
        File.WriteAllText(Path.Combine(scratch, "checkpoints", "4-11.json"), "{}");
        File.WriteAllText(Path.Combine(scratch, "checkpoints", "3-9.json"), "{\"version\":3}");
        var registry = WorldFiles.ReadTemplates(scratch);

        var (deltas, events) = WorldHistory.Since(scratch, 3, registry);

        Meaning.Same(Expected["since"]!["3"]!["events"], Canonical(events));
        Meaning.Same(Expected["since"]!["3"]!["deltas"], Canonical(deltas));
    }

    private static void CopyDirectory(string from, string to)
    {
        foreach (var file in Directory.GetFiles(from))
        {
            File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
        }
        foreach (var folder in Directory.GetDirectories(from))
        {
            var target = Path.Combine(to, Path.GetFileName(folder));
            Directory.CreateDirectory(target);
            CopyDirectory(folder, target);
        }
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
