using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// The write path (src/store/file-store.ts `submit`, `atomicWrite`, `writeHead`, `writeCheckpoint`): one command, decided against the world
// as its files agree, logged whatever it said, with its events and (when accepted) its deltas appended. The snapshot and the checkpoint
// are written on their intervals, and head.json last, so a crash between them leaves a head that names the older state. Holds the
// world's turn for the whole of it.
public static class WorldWriter
{
    public const int SnapshotEvery = 32;
    public const int CheckpointEvery = 256;

    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    public static Pipeline.Result Submit(
        string dir,
        IReadOnlyDictionary<string, Template> registry,
        Command command,
        long? basedOn = null,
        RoundMark? round = null,
        Pipeline.Result? decided = null,
        int snapshotEvery = SnapshotEvery,
        int checkpointEvery = CheckpointEvery)
    {
        if (!WorldFiles.Exists(dir))
        {
            throw new WorldError("no_such_world", $"No world at {dir}");
        }
        return WorldLock.With(dir, () => SubmitLocked(dir, registry, command, basedOn, round, decided, snapshotEvery, checkpointEvery));
    }

    private static Pipeline.Result SubmitLocked(
        string dir,
        IReadOnlyDictionary<string, Template> registry,
        Command command,
        long? basedOn,
        RoundMark? round,
        Pipeline.Result? decided,
        int snapshotEvery,
        int checkpointEvery)
    {
        var current = WorldHistory.Current(dir, registry);
        var basedOnVersion = basedOn ?? current.Version;
        var result = decided
            ?? Submission.ResolveSubmission(current, registry, VerbRegistry.All, command, basedOnVersion, version => SnapshotAt(dir, version, registry));
        var ok = result.Status == Status.Ok;

        var logPath = Path.Combine(dir, WorldFiles.Log);
        var eventsPath = Path.Combine(dir, WorldFiles.Events);
        var deltasPath = Path.Combine(dir, WorldFiles.Deltas);
        File.AppendAllText(logPath, Line(Submission.AttemptOf(command, basedOnVersion, current.Version, result, round)), Utf8);
        foreach (var @event in result.Events)
        {
            File.AppendAllText(eventsPath, Line(@event), Utf8);
        }
        // Only an accepted command's deltas are history; `load` trusts the file once the snapshot below has been written after it.
        if (ok)
        {
            foreach (var delta in result.Deltas)
            {
                File.AppendAllText(deltasPath, Line(delta), Utf8);
            }
        }

        var logSize = new FileInfo(logPath).Length;
        var head = WorldFiles.ReadHead(dir);
        var writesSnapshot = ok && result.Snapshot.Version % snapshotEvery == 0;
        if (writesSnapshot)
        {
            AtomicWrite(Path.Combine(dir, WorldFiles.CurrentSnapshot), Canonical(result.Snapshot));
        }
        var written = new JsonObject
        {
            ["log_bytes"] = logSize,
            ["events_bytes"] = new FileInfo(eventsPath).Length,
            ["deltas_bytes"] = new FileInfo(deltasPath).Length,
            ["log_entries"] = (head?.LogEntries ?? 0) + 1,
            ["ok_entries"] = (head?.OkEntries ?? 0) + (ok ? 1 : 0),
            ["rounds_closed"] = (head?.RoundsClosed ?? 0) + (round?.Close == true ? 1 : 0),
            ["snapshot_version"] = writesSnapshot ? result.Snapshot.Version : head?.SnapshotVersion ?? current.Version,
            ["snapshot_log_bytes"] = writesSnapshot ? logSize : head?.SnapshotLogBytes ?? 0,
            ["templates_hash"] = WorldReplay.HashOf(registry),
        };
        AtomicWrite(Path.Combine(dir, WorldFiles.Head), Canonical(written));
        var writtenHead = new WorldFiles.HeadFile(
            logSize,
            (long)written["events_bytes"]!,
            (long)written["log_entries"]!,
            (long)written["ok_entries"]!,
            (string)written["templates_hash"]!,
            (long)written["deltas_bytes"]!,
            (long)written["rounds_closed"]!,
            (long)written["snapshot_version"]!,
            (long)written["snapshot_log_bytes"]!);
        WorldFiles.RememberHead(dir, writtenHead);
        WorldReplay.Remember(dir, registry, writtenHead, ok ? result.Snapshot : current);

        // The cache is written last and may fail without costing the command anything.
        if (ok && result.Snapshot.Version % checkpointEvery == 0)
        {
            try
            {
                WriteCheckpoint(dir, result.Snapshot, logSize);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // A missing checkpoint only means a longer replay.
            }
        }
        return result;
    }

    // The snapshot at `version` in the log, or null when the log does not reach it (`snapshotAtVersion`): the replay from the newest
    // usable checkpoint at or below it, folded forward to exactly that version.
    private static Snapshot? SnapshotAt(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        var start = WorldCheckpoints.ReplayStart(dir, registry, (candidate, _) => candidate <= version);
        var snapshot = start.Snapshot;
        if (snapshot.Version > version)
        {
            return null;
        }
        foreach (var (entry, line) in start.Entries)
        {
            if (snapshot.Version == version)
            {
                return snapshot;
            }
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new WorldError("replay_diverges", $"Accepted command failed during replay at line {line}");
            }
            snapshot = result.Snapshot;
        }
        return snapshot.Version == version ? snapshot : null;
    }

    // The checkpoint of the snapshot, bound to the log bytes that made it and to `initial.json` (`writeCheckpoint`, `checkpointText`).
    private static void WriteCheckpoint(string dir, Snapshot snapshot, long logBytes)
    {
        var log = WorldIO.ReadAllBytes(Path.Combine(dir, WorldFiles.Log))[..(int)logBytes];
        var folder = Path.Combine(dir, WorldCheckpoints.Folder);
        Directory.CreateDirectory(folder);
        var initial = WorldIO.ReadAllBytes(Path.Combine(dir, WorldFiles.InitialSnapshot));
        AtomicWrite(Path.Combine(folder, $"{snapshot.Version}-{snapshot.NextSeq}.json"), CheckpointText(snapshot, log, initial));
    }

    // The bytes of a checkpoint: the snapshot, bound to the log prefix that made it and to `initial.json`. `verify` builds the same text.
    internal static string CheckpointText(Snapshot snapshot, byte[] log, byte[] initial) =>
        Canonical(new JsonObject
        {
            ["version"] = snapshot.Version,
            ["templates_hash"] = snapshot.TemplatesHash,
            ["log_bytes"] = log.Length,
            ["log_lines"] = log.Count(bytes => bytes == (byte)'\n'),
            ["log_sha256"] = WorldCheckpoints.Digest(log),
            ["initial_sha256"] = WorldCheckpoints.Digest(initial),
            ["snapshot"] = JsonNode.Parse(WorldJson.Write(snapshot)),
        });

    // Replaces `path` with `text` through a temporary file (`atomicWrite`). Windows will not replace a file another process has open at
    // that instant, so the replacement is asked for again for a moment.
    internal static void AtomicWrite(string path, string text)
    {
        var temporary = $"{path}.{Environment.ProcessId}.tmp";
        File.WriteAllText(temporary, text, Utf8);
        for (var attempt = 1; ; attempt += 1)
        {
            try
            {
                File.Move(temporary, path, overwrite: true);
                return;
            }
            catch (Exception error) when ((error is IOException or UnauthorizedAccessException) && attempt < 50)
            {
                Thread.Sleep(Math.Min(attempt, 10));
            }
        }
    }

    // One record as the store writes it: canonical JSON and a newline.
    internal static string Line<T>(T value) => Canonical(value) + "\n";

    internal static string Canonical<T>(T value) => WorldJson.Write(value);
}
