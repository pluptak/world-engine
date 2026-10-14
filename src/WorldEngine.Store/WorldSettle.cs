using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// Opening a world (src/store/file-store.ts `load`, `settle`): the snapshot the files agree on when they agree, else the repair under the
// turn. The repair rebuilds what a crash between the log, event, delta and snapshot appends left behind, from the log: the events and
// deltas when the snapshot is at the log's version, the log folded forward from the head's byte when the snapshot is behind it, or the
// whole replay otherwise. A log that ends inside a line was cut off, and is not settled past it. A head that names another set is taken
// over only when the set is the world's own (`setIsTheWorlds`, as `openWorld` asks); a registry handed in is refused as `templates_changed`.
public static class WorldSettle
{
    public static Snapshot Load(string dir, IReadOnlyDictionary<string, Template> registry, bool setIsTheWorlds = false)
    {
        if (!WorldFiles.Exists(dir))
        {
            throw new WorldError(Code.NoSuchWorld, $"No world at {dir}");
        }
        return WorldReplay.TrustedSnapshot(dir, registry) ?? WorldLock.With(dir, () => Settle(dir, registry, setIsTheWorlds));
    }

    private static Snapshot Settle(string dir, IReadOnlyDictionary<string, Template> registry, bool setIsTheWorlds)
    {
        if (WorldReplay.TrustedSnapshot(dir, registry) is { } trusted)
        {
            return trusted;
        }
        var frozen = WorldReplay.HashOf(registry);
        var snapshotPath = Path.Combine(dir, WorldFiles.CurrentSnapshot);
        var initialPath = Path.Combine(dir, WorldFiles.InitialSnapshot);
        var eventsPath = Path.Combine(dir, WorldFiles.Events);
        var deltasPath = Path.Combine(dir, WorldFiles.Deltas);
        var logPath = Path.Combine(dir, WorldFiles.Log);
        var snapshot = WorldFiles.ReadSnapshot(snapshotPath);
        var initial = WorldFiles.ReadSnapshot(initialPath);
        var head = WorldFiles.ReadHead(dir);
        if (head is not null && head.TemplatesHash != frozen)
        {
            // Only the set in the world's own file may take the world over; a registry handed in is a claim about the set, refused when it fails.
            if (!setIsTheWorlds)
            {
                throw new WorldError(Code.TemplatesChanged, "Template hash mismatch");
            }
            return WorldUpgrade.Takeover(dir, registry, snapshot, initial, head);
        }
        if (snapshot.TemplatesHash != frozen || initial.TemplatesHash != frozen)
        {
            throw new WorldError(Code.TemplatesChanged, "Template hash mismatch");
        }

        // With the turn held no append is under way, so a log that ends inside a line was cut off, and settling past it would let the next
        // append join onto the fragment.
        var log = WorldIO.ReadAllBytes(logPath);
        if (log.Length > 0 && log[^1] != (byte)'\n')
        {
            throw new FormatException($"Log ends inside line {log.Count(bytes => bytes == (byte)'\n') + 1}");
        }
        var entries = WorldFiles.ReadLog(dir);
        var okEntries = entries.Count(entry => entry.Status == Status.Ok);
        var expectedVersion = initial.Version + okEntries;
        var logSize = log.Length;

        // The head as the files now stand, naming the snapshot it holds.
        void WriteSettledHead(long snapshotVersion, long snapshotLogBytes) =>
            WorldWriter.AtomicWrite(
                Path.Combine(dir, WorldFiles.Head),
                WorldWriter.Canonical(new JsonObject
                {
                    ["log_bytes"] = logSize,
                    ["events_bytes"] = new FileInfo(eventsPath).Length,
                    ["deltas_bytes"] = new FileInfo(deltasPath).Length,
                    ["log_entries"] = entries.Count,
                    ["ok_entries"] = okEntries,
                    ["rounds_closed"] = entries.Count(entry => entry.Round?.Close == true),
                    ["snapshot_version"] = snapshotVersion,
                    ["snapshot_log_bytes"] = snapshotLogBytes,
                    ["templates_hash"] = frozen,
                }));

        // The deltas are appended after the events and before the snapshot, so with the snapshot at the log's version they are whole unless
        // the file is missing, was never kept, or is shorter than the head says, which no crash can do. Then they are rebuilt from the log.
        void SettleDeltas()
        {
            if (head is null || head.DeltasBytes is null || !File.Exists(deltasPath) || new FileInfo(deltasPath).Length < head.DeltasBytes)
            {
                WorldWriter.AtomicWrite(deltasPath, DeltaLines(WorldReplay.ReplayWithEvents(dir, registry).Deltas));
            }
        }

        // The snapshot holds every accepted command: it is the current one, whatever the head said.
        if (snapshot.Version == expectedVersion)
        {
            SettleDeltas();
            WriteSettledHead(snapshot.Version, logSize);
            return snapshot;
        }

        // Behind the log, snapshot.json may still be right: the commands since its version are folded onto it, from the log byte the head
        // names. That is only believed when the head was written after the log's last line. Otherwise, or when the fold fails, the world is
        // rebuilt from the log.
        if (head is not null && head.LogBytes == logSize && head.SnapshotVersion == snapshot.Version && head.SnapshotLogBytes is { } fromBytes)
        {
            try
            {
                var current = WorldReplay.FoldLogFrom(dir, snapshot, fromBytes, logSize, registry);
                if (current.Version == expectedVersion)
                {
                    SettleDeltas();
                    WriteSettledHead(snapshot.Version, fromBytes);
                    return current;
                }
            }
            catch (Exception error) when (error is WorldError or FormatException or IOException or JsonException)
            {
                // A snapshot the log cannot be folded onto is rebuilt below, from the log alone.
            }
        }

        var fold = WorldReplay.ReplayWithEvents(dir, registry);
        WorldWriter.AtomicWrite(eventsPath, string.Concat(fold.Events.Select(@event => WorldWriter.Line(@event))));
        WorldWriter.AtomicWrite(deltasPath, DeltaLines(fold.Deltas));
        WorldWriter.AtomicWrite(snapshotPath, WorldWriter.Canonical(fold.Snapshot));
        WriteSettledHead(fold.Snapshot.Version, logSize);
        return fold.Snapshot;
    }

    private static string DeltaLines(IEnumerable<Delta> deltas) => string.Concat(deltas.Select(delta => WorldWriter.Line(delta)));
}
