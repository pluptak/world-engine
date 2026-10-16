using System.Text;
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
    public const string Manifest = "manifest.json";
    public const string Ids = "ids.json";
    public const string Format = "format.json";

    private static readonly string[] AllNames =
        [CurrentSnapshot, InitialSnapshot, Log, Events, Deltas, Head, Templates, Manifest, Ids, Format];

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

    // format.json: the schema the world's files are written in.
    public sealed record FormatFile(long SchemaVersion);

    // Whether a directory holds a world at all: the marker `create` writes first.
    public static bool Exists(string dir) => Present(Path.Combine(dir, Format));

    // Whether any file a world keeps is in the directory, whole or not.
    public static bool HoldsAny(string dir) => AllNames.Any(name => Present(Path.Combine(dir, name)));

    // The set this world was created with, read from its own copy (`readWorldTemplates`). A linked
    // run keeps `manifest.json` instead, resolved through the library three above it. A run with
    // neither file is `invalid_templates`; anywhere else the missing set is no world, as today.
    public static IReadOnlyDictionary<string, Template> ReadTemplates(string dir)
    {
        var setPath = Path.Combine(dir, Templates);
        var manifestPath = Path.Combine(dir, Manifest);
        if (!File.Exists(setPath) && !File.Exists(manifestPath) && !IsRunDir(dir))
        {
            AssertWorldExists(dir);
        }
        if (!File.Exists(setPath) && !File.Exists(manifestPath))
        {
            throw new WorldError(Code.InvalidTemplates, $"World at {dir} has neither {Templates} nor {Manifest}");
        }
        AssertWorldExists(dir);
        if (File.Exists(setPath))
        {
            try
            {
                var declared = ParseRegistry(WorldIO.ReadAllText(setPath), Templates);
                return TemplateResolver.Resolve(declared);
            }
            catch (Exception error)
            {
                throw new WorldError(Code.InvalidTemplates, $"Unreadable template set at {setPath}: {error.Message}");
            }
        }
        try
        {
            var manifest = ValueJson.Parse(WorldIO.ReadAllText(manifestPath)) as Value.Map
                ?? throw new FormatException("manifest.json must pin each template to a revision");
            return Library.TemplateLibrary.Resolve(FindLibrary(dir), ManifestPins(manifest));
        }
        catch (WorldError error) when (error.Code is Code.UnknownTemplate or Code.NoSuchRevision)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        catch (WorldError)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new WorldError(Code.InvalidTemplates, $"Unreadable template set at {manifestPath}: {error.Message}");
        }
    }

    // The library a linked run belongs to: three above `<library>/runs/<world>/<run>`.
    internal static string FindLibrary(string dir)
    {
        if (!IsRunDir(dir))
        {
            throw new WorldError(Code.InvalidTemplates, $"Run at {dir} names no library");
        }
        return Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetFullPath(dir))))!;
    }

    private static bool IsRunDir(string dir)
    {
        var run = Path.GetFullPath(dir);
        var world = Path.GetDirectoryName(run);
        var runs = world is null ? null : Path.GetDirectoryName(world);
        return runs is not null
            && string.Equals(Path.GetFileName(runs), "runs", StringComparison.Ordinal);
    }

    private static IReadOnlyDictionary<string, long> ManifestPins(Value.Map manifest)
    {
        if (manifest.GetValueOrDefault("templates") is not Value.Map templates
            || templates.Values.Any(pin => pin.AsInt() is null or < 1))
        {
            throw new FormatException("manifest.json must pin each template to a revision");
        }
        return templates.ToDictionary(pair => pair.Key, pair => pair.Value.AsInt()!.Value, StringComparer.Ordinal);
    }

    // A snapshot file, checked for the fields `load` relies on before it is taken as a snapshot (`readWorldSnapshot`).
    public static Snapshot ReadSnapshot(string path) => Checked(ValueJson.Parse(WorldIO.ReadAllText(path)), path);

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
            if (ValueJson.Parse(WorldIO.ReadAllText(path)) is not Value.Map value
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
        catch (FormatException)
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
            if (ValueJson.Parse(WorldIO.ReadAllText(path)) is not Value.Map value || value.Values.Any(id => id is not Value.Text))
            {
                throw new FormatException("ids.json is not a map of names to ids");
            }
            return value.ToDictionary(pair => pair.Key, pair => pair.Value.AsText()!, StringComparer.Ordinal);
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidIds, $"Unreadable name map at {path}: {error.Message}");
        }
    }

    private static bool Present(string path) => File.Exists(path) || Directory.Exists(path);

    private static void AssertWorldExists(string dir)
    {
        var missing = new[] { CurrentSnapshot, InitialSnapshot, Log, Events }
            .Where(name => !Present(Path.Combine(dir, name)))
            .ToList();
        if (!Present(Path.Combine(dir, Templates)) && !Present(Path.Combine(dir, Manifest)))
        {
            missing.Add($"{Templates} or {Manifest}");
        }
        if (missing.Count > 0)
        {
            throw new WorldError(Code.NoSuchWorld, $"No world at {dir}: missing {string.Join(", ", missing)}");
        }
        AssertSchema(dir);
    }

    private static void AssertSchema(string dir)
    {
        Value? found = null;
        try
        {
            found = (ValueJson.Parse(WorldIO.ReadAllText(Path.Combine(dir, Format))) as Value.Map)?.GetValueOrDefault("schema_version");
        }
        catch (Exception error) when (error is IOException or FormatException)
        {
            // A world written before the marker existed has no file: the same refusal as a wrong number.
        }
        if (found.AsInt() != SchemaVersion)
        {
            throw new WorldError(
                Code.UnsupportedSchema,
                $"World at {dir} has schema_version {(found is null ? "null" : CanonicalJson.Serialize(found))}, this engine reads {SchemaVersion}");
        }
    }

    // A template set as the world keeps it: an object from id to declaration, checked against its own id (`parseRegistry`).
    private static DeclaredSet ParseRegistry(string text, string source)
    {
        if (WorldEngine.Store.Templates.TemplateDirectory.TemplateValue(text, source) is not Value.Map set)
        {
            throw new FormatException($"{source} must contain a template object");
        }
        var decls = new Dictionary<string, TemplateDecl>(StringComparer.Ordinal);
        var sources = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in set.Keys)
        {
            TemplateShape.Check(set[id], $"{source}#{id}");
            var decl = ValueJson.Read<TemplateDecl>(set[id]);
            if (decl.Id != id)
            {
                throw new FormatException($"{source}#{id} declares id {decl.Id}");
            }
            decls[id] = decl;
            sources[id] = $"{source}#{id}";
        }
        return new DeclaredSet(decls, sources);
    }

    public static Snapshot Checked(Value? value, string path)
    {
        if (value is not Value.Map snapshot
            || Text(snapshot, "templates_hash") is null
            || !SafeInteger(snapshot, "version")
            || !SafeInteger(snapshot, "tick")
            || !SafeInteger(snapshot, "next_seq")
            || snapshot.GetValueOrDefault("coverage") is not Value.Map coverage
            || coverage.GetValueOrDefault("relations") is not Value.List
            || coverage.GetValueOrDefault("senses") is not Value.List
            || coverage.GetValueOrDefault("properties") is not Value.List
            || snapshot.GetValueOrDefault("entities") is not Value.Map
            || (snapshot.ContainsKey("schedule") && snapshot["schedule"] is not Value.List))
        {
            throw new FormatException($"Invalid snapshot file {path}");
        }
        return WorldJson.Read<Snapshot>(snapshot);
    }

    // The bytes through the last newline: a read that overlaps a writer's append takes no line the writer has not finished.
    private static byte[] WholeLines(byte[] bytes) => bytes[..(Array.LastIndexOf(bytes, (byte)'\n') + 1)];

    // One record per non-empty line.
    private static List<T> ParseLines<T>(byte[] bytes, int firstLine, Func<string, int, T> parse)
    {
        var lines = Encoding.UTF8.GetString(bytes).Split('\n');
        var records = new List<T>();
        for (var index = 0; index < lines.Length; index++)
        {
            var line = lines[index].EndsWith('\r') ? lines[index][..^1] : lines[index];
            if (line.Length != 0)
            {
                records.Add(parse(line, firstLine + index));
            }
        }
        return records;
    }

    public static Attempt ParseLogLine(string line, int lineNumber)
    {
        var value = Line(line, lineNumber);
        if (value is null
            || !Number(value, "based_on_version", out _)
            || !SafeInteger(value, "version")
            || Text(value, "status") is not { } status
            || !Statuses.Contains(status)
            || (value.ContainsKey("reason_code") && Text(value, "reason_code") is null)
            || (value.ContainsKey("reason_data") && value["reason_data"] is not Value.Map)
            || (value.ContainsKey("candidates") && value["candidates"] is not Value.List)
            || value.GetValueOrDefault("command") is not Value.Map command
            || Text(command, "command_id") is null
            || Text(command, "actor") is null
            || Text(command, "verb") is null)
        {
            throw new FormatException($"Invalid log entry at line {lineNumber}");
        }
        return Record<Attempt>(value, lineNumber);
    }

    private static WorldEvent ParseEventLine(string line, int lineNumber)
    {
        var value = Line(line, lineNumber);
        if (value is null
            || Text(value, "event_id") is null
            || (value.ContainsKey("cause_id") && Text(value, "cause_id") is null)
            || Text(value, "command_id") is null
            || !SafeInteger(value, "tick")
            || Text(value, "type") is null
            || Text(value, "entity") is null
            || value.GetValueOrDefault("data") is not Value.Map)
        {
            throw new FormatException($"Invalid event entry at line {lineNumber}");
        }
        return Record<WorldEvent>(value, lineNumber);
    }

    private static Delta ParseDeltaLine(string line, int lineNumber)
    {
        var value = Line(line, lineNumber);
        if (value is null
            || Text(value, "event_id") is null
            || Text(value, "entity") is null
            || Text(value, "field") is null)
        {
            throw new FormatException($"Invalid delta entry at line {lineNumber}");
        }
        return Record<Delta>(value, lineNumber);
    }

    // A line as a value; one that does not parse is named by its number, not by the parser's column.
    private static Value.Map? Line(string line, int lineNumber)
    {
        try
        {
            return ValueJson.Parse(line) as Value.Map;
        }
        catch (FormatException)
        {
            throw new FormatException($"Unparsable line {lineNumber}");
        }
    }

    private static T Record<T>(Value.Map value, int lineNumber)
    {
        try
        {
            return WorldJson.Read<T>(value);
        }
        catch (FormatException)
        {
            throw new FormatException($"Unparsable line {lineNumber}");
        }
    }

    // A count or size as head.json or a log line holds it: whole numbers only.
    private static bool Number(Value.Map value, string key, out long number)
    {
        var read = value.GetValueOrDefault(key).AsInt();
        number = read ?? 0;
        return read is not null;
    }

    private static long? Optional(Value.Map value, string key) => Number(value, key, out var number) ? number : null;

    private static string? Text(Value.Map value, string key) => value.GetValueOrDefault(key).AsText();

    private static bool SafeInteger(Value.Map value, string key) => value.GetValueOrDefault(key) is Value.Int;
}
