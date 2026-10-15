using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store.Library;

// A library's templates, every change kept as a revision. The library is a
// directory holding `templates/`, laid out as the repository's is.
public static class TemplateLibrary
{
    public sealed record TemplateEntry(string Id, bool Latest, IReadOnlyList<long> Revisions);

    private static string TemplatesDir(string library) => Path.Combine(library, "templates");

    private static string RevisionsDir(string library) => Path.Combine(TemplatesDir(library), ".revisions");

    private static string LatestPath(string library, string id) => Path.Combine(TemplatesDir(library), id + ".json");

    private static string RevisionPath(string library, string id, long revision) =>
        Path.Combine(RevisionsDir(library), id, revision + ".json");

    // Every id with a latest or a recorded revision, by id.
    public static IReadOnlyList<TemplateEntry> List(string library)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var templatesDir = TemplatesDir(library);
        if (Directory.Exists(templatesDir))
        {
            foreach (var path in Directory.GetFiles(templatesDir, "*.json"))
            {
                ids.Add(Path.GetFileNameWithoutExtension(path));
            }
        }
        var revs = RevisionsDir(library);
        if (Directory.Exists(revs))
        {
            foreach (var dir in Directory.GetDirectories(revs))
            {
                ids.Add(Path.GetFileName(dir));
            }
        }
        var ordered = ids.OrderBy(id => id, StringComparer.Ordinal).ToList();
        return [.. ordered.Select(id => new TemplateEntry(id, File.Exists(LatestPath(library, id)), ReadRevisions(library, id)))];
    }

    // The latest declaration, or that revision's.
    public static Value.Map Get(string library, string id, long? revision = null)
    {
        if (revision is null)
        {
            var path = LatestPath(library, id);
            if (!File.Exists(path))
            {
                throw new WorldError(Code.UnknownTemplate, $"Unknown template {id}");
            }
            return ReadDeclaration(path, id + ".json");
        }
        var revPath = RevisionPath(library, id, revision.Value);
        if (!File.Exists(revPath))
        {
            if (!File.Exists(LatestPath(library, id)) && ReadRevisions(library, id).Count == 0)
            {
                throw new WorldError(Code.UnknownTemplate, $"Unknown template {id}");
            }
            throw new WorldError(Code.NoSuchRevision, $"No revision {revision} of template {id}");
        }
        return ReadDeclaration(revPath, id + "/" + revision);
    }

    // Records the latest file as the next revision when it differs from the
    // highest recorded one. Answers the highest revision number, or 0 when
    // there is no latest and nothing recorded.
    public static long Record(string library, string id)
    {
        var revs = RevisionsDir(library);
        Directory.CreateDirectory(revs);
        return WorldLock.With(revs, () => RecordLocked(library, id));
    }

    private static long RecordLocked(string library, string id)
    {
        var latestPath = LatestPath(library, id);
        var recorded = ReadRevisions(library, id);
        if (!File.Exists(latestPath))
        {
            return recorded.Count == 0 ? 0 : recorded[^1];
        }
        string canonical;
        try
        {
            canonical = CanonicalJson.Serialize(ValueJson.Parse(WorldIO.ReadAllText(latestPath)));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, $"Unreadable template {id}: {error.Message}");
        }
        if (recorded.Count > 0)
        {
            var highestText = WorldIO.ReadAllText(RevisionPath(library, id, recorded[^1]));
            if (string.Equals(CanonicalJson.Serialize(ValueJson.Parse(highestText)), canonical, StringComparison.Ordinal))
            {
                return recorded[^1];
            }
        }
        var next = recorded.Count == 0 ? 1 : recorded[^1] + 1;
        Directory.CreateDirectory(Path.Combine(RevisionsDir(library), id));
        WorldWriter.AtomicWrite(RevisionPath(library, id, next), canonical);
        return next;
    }

    private static IReadOnlyList<long> ReadRevisions(string library, string id)
    {
        var dir = Path.Combine(RevisionsDir(library), id);
        if (!Directory.Exists(dir))
        {
            return [];
        }
        var found = new List<long>();
        foreach (var path in Directory.GetFiles(dir, "*.json"))
        {
            if (long.TryParse(Path.GetFileNameWithoutExtension(path), out var number) && number >= 1)
            {
                found.Add(number);
            }
        }
        found.Sort();
        return found;
    }

    private static Value.Map ReadDeclaration(string path, string source)
    {
        Value? value;
        try
        {
            value = ValueJson.Parse(WorldIO.ReadAllText(path));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, $"Unreadable template at {path}: {error.Message}");
        }
        try
        {
            TemplateShape.Check(value, source);
            var decl = ValueJson.Read<TemplateDecl>(value!);
            return (Value.Map)ValueJson.FromNode(WorldJson.Node(decl))!;
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
    }
}
