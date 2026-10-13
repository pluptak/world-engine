using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// The files a world keeps and how they are read (src/store/file-store.ts: the layout, `worldExists`, `holdsWorldFiles`,
// `readWorldTemplates`, `readWorldSnapshot`, `readHead`, `readLogEntries`, `readEvents`, `readDeltas`, `readWorldIds`). This is the read
// of the files as they stand: the fold that replays them and the repair `load` makes are later blocks. Each reader checks the shape of
// what it reads and refuses what it cannot take, as the TypeScript does, with the same codes.
public static class WorldFiles
{
    // Bumped when a stored file's shape changes; a world written under another number is refused, never read as if it matched.
    public const int SchemaVersion = 5;

    public const string CurrentSnapshot = "snapshot.json";
    public const string InitialSnapshot = "initial.json";
    public const string Log = "log.jsonl";
    public const string Events = "events.jsonl";
    public const string Deltas = "deltas.jsonl";
    public const string Head = "head.json";
    public const string Templates = "templates.json";
    public const string Ids = "ids.json";
    public const string Format = "format.json";

    private static readonly string[] AllNames =
        [CurrentSnapshot, InitialSnapshot, Log, Events, Deltas, Head, Templates, Ids, Format];

    private static readonly string[] Statuses = ["ok", "refused", "ambiguous", "unresolved", "preempted", "invalid"];

    // The fields of head.json the reader keeps. The file is trusted only when its sizes and counts say so (`load`, a later block).
    public sealed record HeadFile(
        long LogBytes,
        long EventsBytes,
        long LogEntries,
        long OkEntries,
        string TemplatesHash,
        long? DeltasBytes,
        long? RoundsClosed,
        long? SnapshotVersion,
        long? SnapshotLogBytes);

    // Whether a directory holds a world at all: the marker `create` writes first.
    public static bool Exists(string dir) => Present(Path.Combine(dir, Format));

    // Whether any file a world keeps is in the directory, whole or not.
    public static bool HoldsAny(string dir) => AllNames.Any(name => Present(Path.Combine(dir, name)));

    // The set this world was created with, read from its own copy (`readWorldTemplates`).
    public static IReadOnlyDictionary<string, Template> ReadTemplates(string dir)
    {
        AssertWorldExists(dir);
        var path = Path.Combine(dir, Templates);
        try
        {
            var declared = ParseRegistry(JsonNode.Parse(WorldIO.ReadAllText(path)), Templates);
            return TemplateResolver.Resolve(declared);
        }
        catch (Exception error)
        {
            throw new WorldError("invalid_templates", $"Unreadable template set at {path}: {error.Message}");
        }
    }

    // A snapshot file, checked for the fields `load` relies on before it is taken as a snapshot (`readWorldSnapshot`).
    public static Snapshot ReadSnapshot(string path) => Checked(JsonNode.Parse(WorldIO.ReadAllText(path)), path);

    // head.json, or null when it is missing or does not carry what a head must (`readHead`).
    public static HeadFile? ReadHead(string dir)
    {
        var path = Path.Combine(dir, Head);
        var info = new FileInfo(path);
        if (!info.Exists)
        {
            return null;
        }
        var stamp = (info.LastWriteTimeUtc.Ticks, info.Length);
        if (Heads.TryGetValue(path, out var known) && known.Stamp == stamp)
        {
            return known.Head;
        }
        var head = ParseHead(path);
        if (head is not null)
        {
            Heads[path] = (stamp, head);
        }
        return head;
    }

    // The head this process wrote last, or read last, by the file's write time and size: a freshly written file is slow to open again on
    // some systems, and the writer knows what it wrote.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, ((long Ticks, long Length) Stamp, HeadFile Head)> Heads = new();

    // Notes the head a writer has just put in head.json, so the next read of it need not open the file.
    public static void RememberHead(string dir, HeadFile head)
    {
        var path = Path.Combine(dir, Head);
        var info = new FileInfo(path);
        if (info.Exists)
        {
            Heads[path] = ((info.LastWriteTimeUtc.Ticks, info.Length), head);
        }
    }

    private static HeadFile? ParseHead(string path)
    {
        try
        {
            if (JsonNode.Parse(WorldIO.ReadAllText(path)) is not JsonObject value
                || !Number(value, "log_bytes", out var logBytes)
                || !Number(value, "events_bytes", out var eventsBytes)
                || !Number(value, "log_entries", out var logEntries)
                || !Number(value, "ok_entries", out var okEntries)
                || Text(value, "templates_hash") is not { } templatesHash)
            {
                return null;
            }
            return new HeadFile(
                logBytes,
                eventsBytes,
                logEntries,
                okEntries,
                templatesHash,
                Optional(value, "deltas_bytes"),
                Optional(value, "rounds_closed"),
                Optional(value, "snapshot_version"),
                Optional(value, "snapshot_log_bytes"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // Every log line as the attempt it is, refused and invalid ones too, in file order (`readLogEntries`). A last line without its
    // newline is a write under way and is left for the next read.
    public static List<Attempt> ReadLog(string dir) =>
        ParseLines(WholeLines(WorldIO.ReadAllBytes(Path.Combine(dir, Log))), 1, ParseLogLine);

    public static List<WorldEvent> ReadEvents(string dir)
    {
        AssertWorldExists(dir);
        return ParseLines(WholeLines(WorldIO.ReadAllBytes(Path.Combine(dir, Events))), 1, ParseEventLine);
    }

    public static List<Delta> ReadDeltas(string dir)
    {
        AssertWorldExists(dir);
        return ParseLines(WholeLines(WorldIO.ReadAllBytes(Path.Combine(dir, Deltas))), 1, ParseDeltaLine);
    }

    // The names a scenario gave its entities, or an empty map when the world has none (`readWorldIds`).
    public static IReadOnlyDictionary<string, string> ReadIds(string dir)
    {
        var path = Path.Combine(dir, Ids);
        if (!File.Exists(path))
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }
        try
        {
            if (JsonNode.Parse(WorldIO.ReadAllText(path)) is not JsonObject value
                || value.Any(pair => JsonReads.Text(pair.Value) is null))
            {
                throw new FormatException("ids.json is not a map of names to ids");
            }
            return value.ToDictionary(pair => pair.Key, pair => JsonReads.Text(pair.Value)!, StringComparer.Ordinal);
        }
        catch (Exception error) when (error is JsonException or FormatException)
        {
            throw new WorldError("invalid_ids", $"Unreadable name map at {path}: {error.Message}");
        }
    }

    private static bool Present(string path) => File.Exists(path) || Directory.Exists(path);

    private static void AssertWorldExists(string dir)
    {
        var missing = new[] { CurrentSnapshot, InitialSnapshot, Log, Events, Templates }
            .Where(name => !Present(Path.Combine(dir, name)))
            .ToList();
        if (missing.Count > 0)
        {
            throw new WorldError("no_such_world", $"No world at {dir}: missing {string.Join(", ", missing)}");
        }
        AssertSchema(dir);
    }

    private static void AssertSchema(string dir)
    {
        JsonNode? found = null;
        try
        {
            found = (JsonNode.Parse(WorldIO.ReadAllText(Path.Combine(dir, Format))) as JsonObject)?["schema_version"];
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            // A world written before the marker existed has no file: the same refusal as a wrong number.
        }
        if (JsonReads.SafeInt(found) != SchemaVersion)
        {
            throw new WorldError(
                "unsupported_schema",
                $"World at {dir} has schema_version {found?.ToJsonString() ?? "null"}, this engine reads {SchemaVersion}");
        }
    }

    // A template set as the world keeps it: an object from id to declaration, checked against its own id (`parseRegistry`).
    private static DeclaredSet ParseRegistry(JsonNode? value, string source)
    {
        if (value is not JsonObject set)
        {
            throw new FormatException($"{source} must contain a template object");
        }
        var decls = new Dictionary<string, TemplateDecl>(StringComparer.Ordinal);
        var sources = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in set.Select(pair => pair.Key).Order(StringComparer.Ordinal))
        {
            TemplateShape.Check(set[id], $"{source}#{id}");
            var decl = WorldJson.Read<TemplateDecl>(set[id]!.ToJsonString());
            if (decl.Id != id)
            {
                throw new FormatException($"{source}#{id} declares id {decl.Id}");
            }
            decls[id] = decl;
            sources[id] = $"{source}#{id}";
        }
        return new DeclaredSet(decls, sources);
    }

    public static Snapshot Checked(JsonNode? value, string path)
    {
        if (value is not JsonObject snapshot
            || Text(snapshot, "templates_hash") is null
            || !SafeInteger(snapshot, "version")
            || !SafeInteger(snapshot, "tick")
            || !SafeInteger(snapshot, "next_seq")
            || snapshot["coverage"] is not JsonObject coverage
            || coverage["relations"] is not JsonArray
            || coverage["senses"] is not JsonArray
            || coverage["properties"] is not JsonArray
            || snapshot["entities"] is not JsonObject
            || (snapshot.ContainsKey("schedule") && snapshot["schedule"] is not JsonArray))
        {
            throw new FormatException($"Invalid snapshot file {path}");
        }
        return WorldJson.Read<Snapshot>(snapshot.ToJsonString());
    }

    // The bytes through the last newline: a read that overlaps a writer's append takes no line the writer has not finished.
    private static byte[] WholeLines(byte[] bytes) => bytes[..(Array.LastIndexOf(bytes, (byte)'\n') + 1)];

    // One record per non-empty line. A line that does not parse is named by its number, not by the parser's column.
    private static List<T> ParseLines<T>(byte[] bytes, int firstLine, Func<string, int, T> parse)
    {
        var lines = Encoding.UTF8.GetString(bytes).Split('\n');
        var records = new List<T>();
        for (var index = 0; index < lines.Length; index++)
        {
            var line = lines[index].EndsWith('\r') ? lines[index][..^1] : lines[index];
            if (line.Length == 0)
            {
                continue;
            }
            try
            {
                records.Add(parse(line, firstLine + index));
            }
            catch (JsonException)
            {
                throw new FormatException($"Unparsable line {firstLine + index}");
            }
        }
        return records;
    }

    public static Attempt ParseLogLine(string line, int lineNumber)
    {
        var value = JsonNode.Parse(line) as JsonObject;
        if (value is null
            || !Number(value, "based_on_version", out _)
            || !SafeInteger(value, "version")
            || Text(value, "status") is not { } status
            || !Statuses.Contains(status)
            || (value.ContainsKey("reason_code") && Text(value, "reason_code") is null)
            || (value.ContainsKey("reason_data") && value["reason_data"] is not JsonObject)
            || (value.ContainsKey("candidates") && value["candidates"] is not JsonArray)
            || !value.ContainsKey("command")
            || value["command"] is not JsonObject command
            || Text(command, "command_id") is null
            || Text(command, "actor") is null
            || Text(command, "verb") is null)
        {
            throw new FormatException($"Invalid log entry at line {lineNumber}");
        }
        return WorldJson.Read<Attempt>(line);
    }

    private static WorldEvent ParseEventLine(string line, int lineNumber)
    {
        var value = JsonNode.Parse(line) as JsonObject;
        if (value is null
            || Text(value, "event_id") is null
            || !value.ContainsKey("cause_id")
            || (value["cause_id"] is not null && Text(value, "cause_id") is null)
            || Text(value, "command_id") is null
            || !SafeInteger(value, "tick")
            || Text(value, "type") is null
            || Text(value, "entity") is null
            || value["data"] is not JsonObject)
        {
            throw new FormatException($"Invalid event entry at line {lineNumber}");
        }
        return WorldJson.Read<WorldEvent>(line);
    }

    private static Delta ParseDeltaLine(string line, int lineNumber)
    {
        var value = JsonNode.Parse(line) as JsonObject;
        if (value is null
            || Text(value, "event_id") is null
            || Text(value, "entity") is null
            || Text(value, "field") is null)
        {
            throw new FormatException($"Invalid delta entry at line {lineNumber}");
        }
        return WorldJson.Read<Delta>(line);
    }

    private static bool Number(JsonObject value, string key, out long number)
    {
        var read = JsonReads.Number(value[key]);
        number = read is null ? 0 : (long)read.Value;
        return read is not null;
    }

    private static long? Optional(JsonObject value, string key) => Number(value, key, out var number) ? number : null;

    private static string? Text(JsonObject value, string key) => JsonReads.Text(value[key]);

    private static bool SafeInteger(JsonObject value, string key) => JsonReads.SafeInt(value[key]) is not null;
}
