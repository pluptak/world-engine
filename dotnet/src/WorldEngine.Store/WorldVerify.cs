using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// Verification (src/store/file-store.ts `verify`, `verifyLocked`, `divergenceOf`): the log replayed from initial.json, each line decided
// again as submit did, then compared with what is stored: the log's own lines, events.jsonl, deltas.jsonl, snapshot.json and the
// checkpoints. It writes nothing, not even the repairs `load` would make, and holds the turn while it reads, since a writer half done
// reads as a divergence. Head is a cache and is not compared.
public static class WorldVerify
{
    // Where the stored files first differ from the replay: the file, the line (0 for a whole file), and why.
    public sealed record Divergence(string File, int Line, string Code);

    // Ok when `Divergence` is null; `Entries` and `Version` are what the replay reached either way.
    public sealed record Verification(Divergence? Divergence, int Entries, long Version)
    {
        public bool Ok => Divergence is null;
    }

    private static readonly Regex CheckpointName = new(@"^(\d+)-(\d+)\.json$", RegexOptions.CultureInvariant);

    public static Verification Verify(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        if (!WorldFiles.Exists(dir))
        {
            throw new WorldError("no_such_world", $"No world at {dir}");
        }
        return WorldLock.With(dir, () => VerifyLocked(dir, registry));
    }

    private static Verification VerifyLocked(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        var initial = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        if (initial.TemplatesHash != WorldReplay.HashOf(registry))
        {
            throw new WorldError("templates_changed", "Template hash mismatch");
        }

        var log = StoredLines(TextOrNull(Path.Combine(dir, WorldFiles.Log)));
        var entries = new List<Attempt>();
        for (var index = 0; index < log.Lines.Count; index++)
        {
            try
            {
                entries.Add(WorldFiles.ParseLogLine(log.Lines[index], index + 1));
            }
            catch (Exception error) when (error is FormatException or System.Text.Json.JsonException or WorldError)
            {
                return Diverges(WorldFiles.Log, index + 1, "differs");
            }
        }

        // A checkpoint is a snapshot the replay should reach: those versions are kept, with how much of the log had been written by then.
        var wanted = new Dictionary<long, string>();
        var folder = Path.Combine(dir, WorldCheckpoints.Folder);
        if (Directory.Exists(folder))
        {
            foreach (var name in Directory.EnumerateFiles(folder).Select(Path.GetFileName).OfType<string>())
            {
                var found = CheckpointName.Match(name);
                if (found.Success)
                {
                    wanted[long.Parse(found.Groups[1].Value)] = name;
                }
            }
        }
        var reached = new Dictionary<long, (Snapshot Snapshot, int Lines)>();

        // A command that raced is judged against the version it was based on, so those snapshots are kept as the replay passes them.
        var based = entries.Select(entry => entry.BasedOnVersion).ToHashSet();
        var kept = new Dictionary<long, Snapshot>();
        var events = new List<string>();
        var deltas = new List<string>();
        // snapshot.json may lag the log, so it is judged against the replay at the version it holds.
        var storedText = TextOrNull(Path.Combine(dir, WorldFiles.CurrentSnapshot));
        var storedVersion = StoredVersion(storedText);
        Snapshot? atStored = initial.Version == storedVersion ? initial : null;
        var snapshot = initial;
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            if (based.Contains(snapshot.Version))
            {
                kept[snapshot.Version] = snapshot;
            }
            // A move a round refused where it started is replayed as logged: the world it would be judged against now is not the one it
            // was judged in, and it took no part.
            var refusedAtStart = entry.Round is { } round && round.Place is null && round.Close != true;
            var result = refusedAtStart
                ? LoggedRefusal(snapshot, entry)
                : Submission.ResolveSubmission(
                    snapshot,
                    registry,
                    VerbRegistry.All,
                    entry.Command,
                    entry.BasedOnVersion,
                    version => kept.TryGetValue(version, out var known) ? known : null);
            var decided = Submission.AttemptOf(entry.Command, entry.BasedOnVersion, snapshot.Version, result, entry.Round);
            if (Canonical(decided) != log.Lines[index])
            {
                var same = decided.Status == entry.Status && decided.ReasonCode == entry.ReasonCode;
                return Diverges(WorldFiles.Log, index + 1, same ? "differs" : "status_differs");
            }
            events.AddRange(result.Events.Select(item => Canonical(item)));
            if (result.Status == Status.Ok)
            {
                deltas.AddRange(result.Deltas.Select(item => Canonical(item)));
                snapshot = result.Snapshot;
                if (snapshot.Version == storedVersion)
                {
                    atStored = snapshot;
                }
                if (wanted.ContainsKey(snapshot.Version))
                {
                    reached[snapshot.Version] = (snapshot, index + 1);
                }
            }
        }
        if (log.Tail != "")
        {
            return Diverges(WorldFiles.Log, log.Lines.Count + 1, "differs");
        }

        var divergence = DivergenceOf(WorldFiles.Events, events, TextOrNull(Path.Combine(dir, WorldFiles.Events)))
            ?? DivergenceOf(WorldFiles.Deltas, deltas, TextOrNull(Path.Combine(dir, WorldFiles.Deltas)));
        if (divergence is not null)
        {
            return new Verification(divergence, entries.Count, snapshot.Version);
        }
        if (storedText is null)
        {
            return Diverges(WorldFiles.CurrentSnapshot, 0, "missing");
        }
        if (atStored is null || storedText != Canonical(atStored))
        {
            return Diverges(WorldFiles.CurrentSnapshot, 0, "differs");
        }

        // Last, in version order: a checkpoint is a cache, but readers start from its snapshot. Each must be exactly what this replay
        // would have written when it reached that version.
        var initialBytes = WorldIO.ReadAllBytes(Path.Combine(dir, WorldFiles.InitialSnapshot));
        foreach (var (version, name) in wanted.OrderBy(pair => pair.Key))
        {
            var file = $"{WorldCheckpoints.Folder}/{name}";
            if (version > snapshot.Version)
            {
                return Diverges(file, 0, "extra");
            }
            if (!reached.TryGetValue(version, out var at))
            {
                return Diverges(file, 0, "differs");
            }
            var prefix = Encoding.UTF8.GetBytes(string.Concat(log.Lines.Take(at.Lines).Select(line => line + "\n")));
            var expected = WorldWriter.CheckpointText(at.Snapshot, prefix, initialBytes);
            if (name != $"{version}-{at.Snapshot.NextSeq}.json" || TextOrNull(Path.Combine(folder, name)) != expected)
            {
                return Diverges(file, 0, "differs");
            }
        }
        return new Verification(null, entries.Count, snapshot.Version);
    }

    // What a logged refusal said, with nothing applied (`loggedRefusal`).
    private static Pipeline.Result LoggedRefusal(Snapshot snapshot, Attempt entry) =>
        new(
            entry.Status,
            entry.Command.CommandId,
            null,
            entry.Candidates,
            entry.ReasonCode,
            entry.ReasonData,
            snapshot,
            Array.Empty<Delta>(),
            Array.Empty<WorldEvent>());

    // The complete lines of a file's text, and what follows the last newline: nothing, unless a write was cut off or the file was edited.
    private static (List<string> Lines, string Tail) StoredLines(string? text)
    {
        var lines = (text ?? "").Split('\n').ToList();
        var tail = lines[^1];
        lines.RemoveAt(lines.Count - 1);
        return (lines, tail);
    }

    // A file against the lines the log makes of it, byte for byte (`divergenceOf`).
    private static Divergence? DivergenceOf(string file, IReadOnlyList<string> expected, string? text)
    {
        var (lines, tail) = StoredLines(text);
        for (var index = 0; index < Math.Min(lines.Count, expected.Count); index++)
        {
            if (lines[index] != expected[index])
            {
                return new Divergence(file, index + 1, "differs");
            }
        }
        if (lines.Count < expected.Count)
        {
            return new Divergence(file, lines.Count + 1, tail == "" ? "missing" : "differs");
        }
        if (lines.Count > expected.Count || tail != "")
        {
            return new Divergence(file, expected.Count + 1, "extra");
        }
        return null;
    }

    // The version a stored snapshot says it is; null when it is not JSON or has no version, which matches no replay.
    private static long? StoredVersion(string? text)
    {
        if (text is null)
        {
            return null;
        }
        try
        {
            return JsonNode.Parse(text) is JsonObject value ? JsonReads.SafeInt(value["version"]) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? TextOrNull(string path) => File.Exists(path) ? WorldIO.ReadAllText(path) : null;

    private static string Canonical<T>(T value) => WorldJson.Canonicalize(WorldJson.Write(value));

    private static Verification Diverges(string file, int line, string code) => new(new Divergence(file, line, code), 0, 0);
}
