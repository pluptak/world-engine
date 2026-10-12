using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// Replaying a world's log (src/store/file-store.ts `replayFold`, `foldLogFrom`, `trustedSnapshot`, `replayWithEvents`, `replay`): the
// accepted commands of the log, decided again on the snapshot they start from, which gives the current snapshot and the events and
// deltas a store writes. `TrustedSnapshot` is the read `load` takes when the files agree; the repair that settles files which do not
// agree, and the set changes, are the write path's and come with it.
public static class WorldReplay
{
    // What a replay makes: the snapshot it ends at, and every event and delta of the accepted commands in log order.
    public sealed record Fold(Snapshot Snapshot, IReadOnlyList<WorldEvent> Events, IReadOnlyList<Delta> Deltas);

    // The hash of a resolved template set: the same as the set's `templatesHash` (src/templates.ts), so it can be checked against the
    // hash a snapshot carries.
    public static string HashOf(IReadOnlyDictionary<string, Template> registry)
    {
        var declared = new JsonObject();
        foreach (var (id, template) in registry)
        {
            declared[id] = JsonNode.Parse(WorldJson.Write(template));
        }
        return TemplateHash.Of(declared);
    }

    // Replays the whole log from initial.json. An accepted command that no longer applies is a divergence, named by its line.
    public static Fold ReplayFold(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        var events = new List<WorldEvent>();
        var deltas = new List<Delta>();
        var entries = WorldFiles.ReadLog(dir);
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new WorldError("replay_diverges", $"Accepted command failed during replay at line {index + 1}");
            }
            events.AddRange(result.Events);
            deltas.AddRange(result.Deltas);
            snapshot = result.Snapshot;
        }
        return new Fold(snapshot, events, deltas);
    }

    // The snapshot the log makes from `start`, folding only the accepted commands between two bytes of the log (`foldLogFrom`).
    public static Snapshot FoldLogFrom(string dir, Snapshot start, long from, long to, IReadOnlyDictionary<string, Template> registry)
    {
        var bytes = ReadRange(Path.Combine(dir, WorldFiles.Log), from, to);
        var lines = Encoding.UTF8.GetString(bytes).Split('\n');
        var snapshot = start;
        // The text after the last newline is not a line (it is empty for a range the head names).
        for (var index = 0; index < lines.Length - 1; index++)
        {
            var entry = WorldFiles.ParseLogLine(lines[index], index + 1);
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new FormatException($"Accepted command failed during replay after log byte {from}");
            }
            snapshot = result.Snapshot;
        }
        return snapshot;
    }

    // The current snapshot, when the files agree with the head that describes them, without writing anything: the stored snapshot
    // folded forward over the log bytes after it. Null when the head or the sizes do not agree, or the fold does not reach the version
    // the accepted entries make; the caller then settles the world under the turn (`load`). A set other than the one the world holds
    // is refused, as `load` refuses it. The TypeScript process also keeps the snapshot it last returned, which only saves a fold.
    public static Snapshot? TrustedSnapshot(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        var initial = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        var head = WorldFiles.ReadHead(dir);
        var frozen = HashOf(registry);
        if (head is null || head.TemplatesHash != frozen)
        {
            return null;
        }
        AssertTemplates(initial.TemplatesHash, frozen);
        try
        {
            if (FileSize(Path.Combine(dir, WorldFiles.Log)) == head.LogBytes
                && FileSize(Path.Combine(dir, WorldFiles.Events)) == head.EventsBytes
                && head.DeltasBytes is { } deltasBytes
                && FileSize(Path.Combine(dir, WorldFiles.Deltas)) == deltasBytes
                && head.RoundsClosed is not null
                && head.SnapshotVersion is { } snapshotVersion
                && head.SnapshotLogBytes is { } snapshotLogBytes)
            {
                var stored = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.CurrentSnapshot));
                AssertTemplates(stored.TemplatesHash, frozen);
                if (stored.Version == snapshotVersion)
                {
                    var current = FoldLogFrom(dir, stored, snapshotLogBytes, head.LogBytes, registry);
                    if (current.Version == initial.Version + head.OkEntries)
                    {
                        return current;
                    }
                }
            }
        }
        catch (Exception error) when (error is WorldError or IOException or FormatException or JsonException)
        {
            // Fall through to the full check, which settles the world or says why it cannot.
        }
        return null;
    }

    // The replay from initial.json with the templates the world holds, checked against initial.json (`replayWithEvents`).
    public static Fold ReplayWithEvents(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        AssertTemplates(WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot)).TemplatesHash, HashOf(registry));
        return ReplayFold(dir, registry);
    }

    private static void AssertTemplates(string snapshotHash, string frozen)
    {
        if (snapshotHash != frozen)
        {
            throw new WorldError("templates_changed", "Template hash mismatch");
        }
    }

    private static long FileSize(string path) => new FileInfo(path).Length;

    // Exactly the bytes from `from` up to `to`: a range the head names, which must be there in full.
    private static byte[] ReadRange(string path, long from, long to)
    {
        var bytes = new byte[to - from];
        using var stream = WorldIO.OpenRead(path);
        stream.Seek(from, SeekOrigin.Begin);
        var filled = 0;
        while (filled < bytes.Length)
        {
            var count = stream.Read(bytes, filled, bytes.Length - filled);
            if (count == 0)
            {
                throw new FormatException($"Log ends before byte {to}");
            }
            filled += count;
        }
        return bytes;
    }
}
