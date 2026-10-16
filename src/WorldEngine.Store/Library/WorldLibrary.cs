using System.Text.RegularExpressions;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Store.Library;

// A library's worlds, each a scenario and the template revisions it is pinned
// to, kept by revision under `worlds/`.
public static class WorldLibrary
{
    public sealed record WorldEntry(string Name, IReadOnlyList<long> Revisions);

    public sealed record WorldData(Value Scenario, Value.Map Manifest);

    private static readonly Regex NamePattern = new("^[a-z0-9_-]+$", RegexOptions.CultureInvariant);

    private static string WorldsDir(string library) => Path.Combine(library, "worlds");

    private static string WorldDir(string library, string name) => Path.Combine(WorldsDir(library), name);

    private static string RevisionDir(string library, string name, long revision) =>
        Path.Combine(WorldDir(library, name), revision.ToString());

    private static void CheckName(string name)
    {
        if (!NamePattern.IsMatch(name))
        {
            throw new WorldError(Code.InvalidWorld, $"Invalid world {name}");
        }
    }

    // Each name with its revisions, by name. Reads take no lock.
    public static IReadOnlyList<WorldEntry> List(string library)
    {
        var worlds = WorldsDir(library);
        if (!Directory.Exists(worlds))
        {
            return [];
        }
        return [.. Directory.GetDirectories(worlds)
            .Select(Path.GetFileName)
            .OfType<string>()
            .Order(StringComparer.Ordinal)
            .Select(name => new WorldEntry(name, ReadWorldRevisions(library, name)))];
    }

    // The scenario and the manifest of a revision, the latest by default.
    public static WorldData Get(string library, string name, long? revision = null)
    {
        CheckName(name);
        if (!Directory.Exists(WorldDir(library, name)))
        {
            throw new WorldError(Code.NoSuchWorld, $"No world {name}");
        }
        var revisions = ReadWorldRevisions(library, name);
        if (revisions.Count == 0)
        {
            throw new WorldError(Code.NoSuchWorld, $"No world {name}");
        }
        var wanted = revision ?? revisions[^1];
        if (!revisions.Contains(wanted))
        {
            throw new WorldError(Code.NoSuchRevision, $"No revision {wanted} of world {name}");
        }
        var dir = RevisionDir(library, name, wanted);
        Value scenario;
        try
        {
            scenario = ValueJson.Parse(WorldIO.ReadAllText(Path.Combine(dir, "scenario.json")))
                ?? throw new FormatException("scenario.json must contain a scenario");
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidWorld, $"Unreadable scenario of world {name}: {error.Message}");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new WorldError(Code.InvalidWorld, $"Unreadable scenario of world {name}: {error.Message}");
        }
        Value.Map manifest;
        try
        {
            manifest = ValueJson.Parse(WorldIO.ReadAllText(Path.Combine(dir, "manifest.json"))) as Value.Map
                ?? throw new FormatException("manifest.json must contain a template object");
            ManifestPins(manifest);
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidWorld, $"Unreadable manifest of world {name}: {error.Message}");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new WorldError(Code.InvalidWorld, $"Unreadable manifest of world {name}: {error.Message}");
        }
        return new WorldData(scenario, manifest);
    }

    // Adds a world, pinning every id of the latest set. Answers revision 1.
    public static long Add(string library, string name, Value scenario)
    {
        CheckName(name);
        var root = TemplateLibrary.RevisionsRoot(library);
        Directory.CreateDirectory(root);
        return WorldLock.With(root, () => AddLocked(library, name, scenario));
    }

    // Edits a world, pinning the latest set anew. Answers the new revision.
    public static long Edit(string library, string name, Value scenario)
    {
        CheckName(name);
        var root = TemplateLibrary.RevisionsRoot(library);
        Directory.CreateDirectory(root);
        return WorldLock.With(root, () => EditLocked(library, name, scenario));
    }

    // Deletes a world and its runs. Each run's turn is taken first, so a run
    // being written refuses `store_busy` with nothing deleted.
    public static void Delete(string library, string name)
    {
        CheckName(name);
        var root = TemplateLibrary.RevisionsRoot(library);
        Directory.CreateDirectory(root);
        WorldLock.With(root, () =>
        {
            DeleteLocked(library, name);
            return true;
        });
    }

    private static void DeleteLocked(string library, string name)
    {
        if (!Directory.Exists(WorldDir(library, name)) || ReadWorldRevisions(library, name).Count == 0)
        {
            throw new WorldError(Code.NoSuchWorld, $"No world {name}");
        }
        var runs = Path.Combine(library, "runs", name);
        if (Directory.Exists(runs))
        {
            foreach (var run in Directory.GetDirectories(runs)
                .Order(StringComparer.Ordinal))
            {
                WorldLock.With(run, () => true);
            }
        }
        Directory.Delete(WorldDir(library, name), recursive: true);
        if (Directory.Exists(runs))
        {
            Directory.Delete(runs, recursive: true);
        }
    }

    private static long AddLocked(string library, string name, Value scenario)
    {
        if (Directory.Exists(WorldDir(library, name)))
        {
            throw new WorldError(Code.WorldExists, $"A world named {name} already exists");
        }
        CheckScenario(scenario);
        var manifest = Pin(library, scenario);
        WriteRevision(library, name, 1, scenario, manifest);
        return 1;
    }

    private static long EditLocked(string library, string name, Value scenario)
    {
        if (!Directory.Exists(WorldDir(library, name)))
        {
            throw new WorldError(Code.NoSuchWorld, $"No world {name}");
        }
        CheckScenario(scenario);
        var manifest = Pin(library, scenario);
        var revisions = ReadWorldRevisions(library, name);
        var next = revisions.Count == 0 ? 1 : revisions[^1] + 1;
        WriteRevision(library, name, next, scenario, manifest);
        return next;
    }

    // The manifest pinning every id of the latest set, each recorded first.
    // The scenario is built against the latest set before anything is
    // recorded (the snapshot discarded): a recorded revision is the latest
    // file in canonical form, so the set is the one the pins resolve to, and
    // a scenario's refusal leaves the library as it was.
    private static Value.Map Pin(string library, Value scenario)
    {
        DeclaredSet latest;
        var templatesDir = Path.Combine(library, "templates");
        try
        {
            latest = Directory.Exists(templatesDir)
                ? TemplateDirectory.ReadDeclarations(templatesDir)
                : new DeclaredSet(
                    new Dictionary<string, TemplateDecl>(StringComparer.Ordinal),
                    new Dictionary<string, string>(StringComparer.Ordinal));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        IReadOnlyDictionary<string, Template> registry;
        try
        {
            registry = TemplateResolver.Resolve(latest);
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        WorldBuilder.Snapshot(scenario, registry);
        var pins = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var id in latest.Decls.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            pins[id] = TemplateLibrary.Record(library, id);
        }
        TemplateLibrary.Resolve(library, pins);
        return Value.Map.Empty.With(
            "templates",
            Value.Of(pins.Select(pin => KeyValuePair.Create<string, Value?>(pin.Key, pin.Value))));
    }

    private static void WriteRevision(string library, string name, long revision, Value scenario, Value.Map manifest)
    {
        var dir = RevisionDir(library, name, revision);
        Directory.CreateDirectory(dir);
        WorldWriter.AtomicWrite(Path.Combine(dir, "scenario.json"), CanonicalJson.Serialize(scenario));
        WorldWriter.AtomicWrite(Path.Combine(dir, "manifest.json"), CanonicalJson.Serialize(manifest));
    }

    // The scenario as `init` takes it; the deeper shape is the snapshot's to
    // refuse. `Store` must not reference `Contract`, so the `IsScenario`
    // check itself lives in the CLI beside `init`'s.
    private static void CheckScenario(Value scenario)
    {
        if (scenario is not (Value.List or Value.Map))
        {
            throw new WorldError(Code.InvalidScenario, "The scenario is no list of entries or scene");
        }
    }

    private static IReadOnlyList<long> ReadWorldRevisions(string library, string name)
    {
        var dir = WorldDir(library, name);
        if (!Directory.Exists(dir))
        {
            return [];
        }
        var found = new List<long>();
        foreach (var path in Directory.GetDirectories(dir))
        {
            if (long.TryParse(Path.GetFileName(path), out var number) && number >= 1)
            {
                found.Add(number);
            }
        }
        found.Sort();
        return found;
    }

    internal static IReadOnlyDictionary<string, long> ManifestPins(Value.Map manifest)
    {
        if (manifest.GetValueOrDefault("templates") is not Value.Map templates
            || templates.Values.Any(pin => pin.AsInt() is null or < 1))
        {
            throw new FormatException("manifest.json must pin each template to a revision");
        }
        return templates.ToDictionary(pair => pair.Key, pair => pair.Value.AsInt()!.Value, StringComparer.Ordinal);
    }
}
