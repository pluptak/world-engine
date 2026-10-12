using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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

        var log = File.ReadAllBytes(Path.Combine(dir, WorldFiles.Log));
        var hash = WorldReplay.HashOf(registry);
        var initialDigest = Digest(File.ReadAllBytes(Path.Combine(dir, WorldFiles.InitialSnapshot)));
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
            if (JsonNode.Parse(File.ReadAllText(path)) is not JsonObject value
                || JsonReads.SafeInt(value["version"]) != version
                || JsonReads.Text(value["templates_hash"]) != hash
                || JsonReads.SafeInt(value["log_bytes"]) is not { } bytes
                || JsonReads.SafeInt(value["log_lines"]) is not { } lines
                || JsonReads.Text(value["log_sha256"]) is not { } logDigest
                || JsonReads.Text(value["initial_sha256"]) != initialDigest)
            {
                return null;
            }
            if (bytes < 0 || bytes > log.Length || (bytes > 0 && log[bytes - 1] != (byte)'\n') || Digest(log[..(int)bytes]) != logDigest)
            {
                return null;
            }
            var snapshot = WorldFiles.Checked(value["snapshot"], path);
            if (snapshot.Version != version || snapshot.NextSeq != nextSeq || snapshot.TemplatesHash != hash)
            {
                return null;
            }
            return new Checkpoint(snapshot, bytes, lines);
        }
        catch (Exception error) when (error is IOException or JsonException or FormatException or WorldError)
        {
            return null;
        }
    }

    // The bytes through the last newline: what a read of a log being appended to takes as whole lines.
    private static byte[] WholeLines(byte[] bytes) => bytes[..(Array.LastIndexOf(bytes, (byte)'\n') + 1)];

    internal static string Digest(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
}
