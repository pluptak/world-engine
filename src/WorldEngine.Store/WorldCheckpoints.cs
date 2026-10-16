using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// Checkpoints (src/store/file-store.ts `readCheckpoint`, `replayStart`): a cache of the log, written every few accepted commands as the
// snapshot it reached, bound to the exact log bytes that made it, to `initial.json` and to the template set. A replay that wants history
// from some version on starts from the newest usable checkpoint and reads only the log after it. One that does not parse, is for another
// set or interval, is ahead of the log, or whose bytes are not the log's own prefix is ignored; with none usable, the replay starts from
// `initial.json`. The answer never depends on which it starts from.
public static class WorldCheckpoints
{
    public const string Folder = "checkpoints";

    private static readonly Regex Name = new(@"^(\d+)-(\d+)\.json$", RegexOptions.CultureInvariant);

    // Where a replay begins: the snapshot it starts from, the log entries after it with their line numbers, and whether that snapshot is
    // `initial.json` itself (`fromInitial`), in which case the events through a command are the ones the replay collected.
    public sealed record Start(Snapshot Snapshot, IReadOnlyList<(Attempt Entry, int Line)> Entries, bool FromInitial);

    private sealed record Checkpoint(Snapshot Snapshot, long LogBytes, long LogLines);

    // The newest checkpoint that `accept` takes by its version and next sequence number, which are in its name so nothing is parsed to
    // choose; `initial.json` when none is usable.
    public static Start ReplayStart(string dir, IReadOnlyDictionary<string, Template> registry, Func<long, long, bool> accept)
    {
        var folder = Path.Combine(dir, Folder);
        if (!Directory.Exists(folder))
        {
            return FromInitial(dir);
        }
        var candidates = Directory.EnumerateFiles(folder)
            .Select(Path.GetFileName)
            .OfType<string>()
            .Select(name => (Name: name, Match: Name.Match(name)))
            .Where(candidate => candidate.Match.Success)
            .Select(candidate => (candidate.Name, Version: long.Parse(candidate.Match.Groups[1].Value), Next: long.Parse(candidate.Match.Groups[2].Value)))
            .Where(candidate => accept(candidate.Version, candidate.Next))
            .OrderByDescending(candidate => candidate.Version)
            .ToList();
        if (candidates.Count == 0)
        {
            return FromInitial(dir);
        }

        var log = WorldIO.ReadAllBytes(Path.Combine(dir, WorldFiles.Log));
        var hash = WorldReplay.HashOf(registry);
        var initialDigest = Digest(WorldIO.ReadAllBytes(Path.Combine(dir, WorldFiles.InitialSnapshot)));
        foreach (var candidate in candidates)
        {
            var checkpoint = ReadCheckpoint(Path.Combine(folder, candidate.Name), candidate.Version, candidate.Next, hash, log, initialDigest);
            if (checkpoint is null)
            {
                continue;
            }
            var tail = Encoding.UTF8.GetString(WholeLines(log[(int)checkpoint.LogBytes..]));
            var entries = new List<(Attempt Entry, int Line)>();
            foreach (var text in tail.Split('\n').Where(text => text.Length > 0))
            {
                var line = (int)checkpoint.LogLines + entries.Count + 1;
                entries.Add((WorldFiles.ParseLogLine(text.EndsWith('\r') ? text[..^1] : text, line), line));
            }
            return new Start(checkpoint.Snapshot, entries, FromInitial: false);
        }
        return FromInitial(dir);
    }

    private static Start FromInitial(string dir)
    {
        var entries = WorldFiles.ReadLog(dir).Select((entry, index) => (entry, index + 1)).ToList();
        return new Start(WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot)), entries, FromInitial: true);
    }

    // The checkpoint if it is this one: bound to the log prefix it names, to initial.json and to the set, and of the version and next
    // sequence number its name gives. Null otherwise, which the caller takes as no checkpoint.
    private static Checkpoint? ReadCheckpoint(string path, long version, long nextSeq, string hash, byte[] log, string initialDigest)
    {
        try
        {
            if (ValueJson.Parse(WorldIO.ReadAllText(path)) is not Value.Map value
                || value.GetValueOrDefault("version").AsInt() != version
                || value.GetValueOrDefault("templates_hash").AsText() != hash
                || value.GetValueOrDefault("log_bytes").AsInt() is not { } bytes
                || value.GetValueOrDefault("log_lines").AsInt() is not { } lines
                || value.GetValueOrDefault("log_sha256").AsText() is not { } logDigest
                || value.GetValueOrDefault("initial_sha256").AsText() != initialDigest)
            {
                return null;
            }
            if (bytes < 0 || bytes > log.Length || (bytes > 0 && log[bytes - 1] != (byte)'\n') || Digest(log[..(int)bytes]) != logDigest)
            {
                return null;
            }
            var snapshot = WorldFiles.Checked(value.GetValueOrDefault("snapshot"), path);
            if (snapshot.Version != version || snapshot.NextSeq != nextSeq || snapshot.TemplatesHash != hash)
            {
                return null;
            }
            return new Checkpoint(snapshot, bytes, lines);
        }
        catch (Exception error) when (error is IOException or FormatException or WorldError)
        {
            return null;
        }
    }

    // The bytes through the last newline: what a read of a log being appended to takes as whole lines.
    private static byte[] WholeLines(byte[] bytes) => bytes[..(Array.LastIndexOf(bytes, (byte)'\n') + 1)];

    // Removes every checkpoint, which a change of set or of the log makes stale (`dropCheckpoints`).
    internal static void Drop(string dir)
    {
        var folder = Path.Combine(dir, Folder);
        if (Directory.Exists(folder))
        {
            Directory.Delete(folder, recursive: true);
        }
    }

    // A checkpoint file: the snapshot, bound to the log prefix that made it (its bytes, lines and digest) and to `initial.json`.
    internal sealed record CheckpointFile(
        long Version,
        string TemplatesHash,
        long LogBytes,
        long LogLines,
        string LogSha256,
        string InitialSha256,
        Snapshot Snapshot);

    internal static string Digest(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
