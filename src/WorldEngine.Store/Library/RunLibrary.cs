using System.Text.RegularExpressions;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store.Library;

// Runs started from a library world's revisions, each a store world linked to
// its template revisions by a manifest instead of a copied `templates.json`.
public static class RunLibrary
{
    public sealed record RunEntry(string Run, long WorldRevision);

    public sealed record Started(string Dir, long SnapshotVersion);

    private static readonly Regex NamePattern = new("^[a-z0-9_-]+$", RegexOptions.CultureInvariant);

    private static string RunsDir(string library, string world) => Path.Combine(library, "runs", world);

    private static string RunDir(string library, string world, string run) => Path.Combine(RunsDir(library, world), run);

    private static void CheckWorld(string world)
    {
        if (!NamePattern.IsMatch(world))
        {
            throw new WorldError(Code.InvalidWorld, $"Invalid world {world}");
        }
    }

    private static void CheckRun(string run)
    {
        if (!NamePattern.IsMatch(run))
        {
            throw new WorldError(Code.InvalidWorld, $"Invalid run {run}");
        }
    }

    // Each run of the world with the revision it was started from, by run.
    public static IReadOnlyList<RunEntry> List(string library, string world)
    {
        CheckWorld(world);
        var dir = RunsDir(library, world);
        if (!Directory.Exists(dir))
        {
            if (!WorldLibrary.List(library).Any(entry => entry.Name == world))
            {
                throw new WorldError(Code.NoSuchWorld, $"No world {world}");
            }
            return [];
        }
        return [.. Directory.GetDirectories(dir)
            .Select(Path.GetFileName)
            .OfType<string>()
            .Order(StringComparer.Ordinal)
            .Select(run => new RunEntry(run, ReadWorldRevision(RunDir(library, world, run))))];
    }

    // The pinned templates with a higher recorded revision, and the latest
    // ids the manifest does not pin. The latest set is recorded first.
    public static Value.Map Plan(string library, string world, long? revision = null)
    {
        var data = WorldLibrary.Get(library, world, revision);
        var rev = revision ?? WorldLibrary.List(library).Single(entry => entry.Name == world).Revisions[^1];
        var pins = WorldLibrary.ManifestPins(data.Manifest);
        var newer = new List<Value>();
        foreach (var id in pins.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var latest = TemplateLibrary.Record(library, id);
            if (latest > pins[id])
            {
                newer.Add(
                    Value.Map.Empty
                        .With("template", id)
                        .With("pinned", pins[id])
                        .With("latest", latest));
            }
        }
        var added = TemplateLibrary.List(library)
            .Where(entry => entry.Latest && !pins.ContainsKey(entry.Id))
            .Select(entry => entry.Id)
            .Order(StringComparer.Ordinal)
            .Select(id => (Value)id)
            .ToList();
        return Value.Map.Empty
            .With("world", world)
            .With("revision", rev)
            .With("newer", Value.Of(newer))
            .With("added", Value.Of(added));
    }

    // A run of the world's revision, with `use` applied (a revision number or
    // `"latest"` per id; an id the manifest does not pin is pinned too).
    public static Started Start(string library, string world, long? revision, string run, Value.Map? use)
    {
        CheckWorld(world);
        CheckRun(run);
        var root = TemplateLibrary.RevisionsRoot(library);
        Directory.CreateDirectory(root);
        return WorldLock.With(root, () => StartLocked(library, world, revision, run, use));
    }

    private static Started StartLocked(string library, string world, long? revision, string run, Value.Map? use)
    {
        var dir = RunDir(library, world, run);
        if (WorldFiles.HoldsAny(dir))
        {
            throw new WorldError(Code.WorldExists, $"A run named {run} of world {world} already exists");
        }
        var data = WorldLibrary.Get(library, world, revision);
        var rev = revision ?? WorldLibrary.List(library).Single(entry => entry.Name == world).Revisions[^1];
        var pins = new Dictionary<string, long>(WorldLibrary.ManifestPins(data.Manifest), StringComparer.Ordinal);
        IReadOnlyDictionary<string, Template> registry;
        try
        {
            if (use is not null)
            {
                foreach (var pair in use)
                {
                    if (pair.Value.AsText() == "latest")
                    {
                        pins[pair.Key] = TemplateLibrary.Record(library, pair.Key);
                    }
                    else if (pair.Value.AsInt() is { } number)
                    {
                        pins[pair.Key] = number;
                    }
                    else
                    {
                        throw new WorldError(Code.InvalidTemplates, $"Use of template {pair.Key} is no revision or latest");
                    }
                }
            }
            registry = TemplateLibrary.Resolve(library, pins);
        }
        catch (WorldError error) when (error.Code is Code.UnknownTemplate or Code.InvalidRequest)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        var made = WorldBuilder.Snapshot(data.Scenario, registry);
        var manifest = Value.Map.Empty
            .With("world", world)
            .With("world_revision", rev)
            .With("templates", Value.Of(pins
                .OrderBy(pin => pin.Key, StringComparer.Ordinal)
                .Select(pin => KeyValuePair.Create<string, Value?>(pin.Key, pin.Value))));
        WorldBuilder.Create(dir, made.Snapshot, made.Ids, manifest);
        return new Started(dir, made.Snapshot.Version);
    }

    private static long ReadWorldRevision(string dir)
    {
        try
        {
            if (ValueJson.Parse(WorldIO.ReadAllText(Path.Combine(dir, "manifest.json"))) is Value.Map manifest
                && manifest.GetValueOrDefault("world_revision").AsInt() is { } revision)
            {
                return revision;
            }
            throw new FormatException("manifest.json must name its world revision");
        }
        catch (Exception error) when (error is FormatException or IOException or UnauthorizedAccessException)
        {
            throw new WorldError(Code.InvalidWorld, $"Unreadable manifest at {dir}: {error.Message}");
        }
    }
}
