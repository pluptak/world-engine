using System.Text.RegularExpressions;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Store.Library;

// A library's templates, every change kept as a revision. The library is a
// directory holding `templates/`, laid out as the repository's is.
public static class TemplateLibrary
{
    public sealed record TemplateEntry(string Id, bool Latest, IReadOnlyList<long> Revisions);

    // A template id is a plain file name: words of lower letters, digits and `_`, joined by `.` as a companion's are
    // (`human.hand_l`). Anything else could name a file outside `templates/`.
    private static readonly Regex IdPattern = new(@"^[a-z0-9_]+(\.[a-z0-9_]+)*\z", RegexOptions.CultureInvariant);

    private static bool IsPlainId(string id) => IdPattern.IsMatch(id);

    // An id a request names: one that is no plain file name is refused before any path is made of it.
    private static void CheckRequestId(string id)
    {
        if (!IsPlainId(id))
        {
            throw new WorldError(Code.InvalidRequest, $"Template id {id} is no plain file name");
        }
    }

    private static string TemplatesDir(string library) => Path.Combine(library, "templates");

    private static string RevisionsDir(string library) => Path.Combine(TemplatesDir(library), ".revisions");

    private static string LatestPath(string library, string id) => Path.Combine(TemplatesDir(library), id + ".json");

    private static string RevisionPath(string library, string id, long revision) =>
        Path.Combine(RevisionsDir(library), id, revision + ".json");

    // The directory writers take their turn on.
    internal static string RevisionsRoot(string library) => RevisionsDir(library);

    // The registry from the named revision files, so a world's set is the
    // same however the latest set moves on.
    public static IReadOnlyDictionary<string, Template> Resolve(string library, IReadOnlyDictionary<string, long> manifest)
    {
        var texts = new List<(string File, string Text)>();
        foreach (var id in manifest.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            if (!IsPlainId(id))
            {
                throw new WorldError(Code.InvalidTemplates, $"Template id {id} is no plain file name");
            }
            var path = RevisionPath(library, id, manifest[id]);
            if (!File.Exists(path))
            {
                if (!File.Exists(LatestPath(library, id)) && ReadRevisions(library, id).Count == 0)
                {
                    throw new WorldError(Code.UnknownTemplate, $"Unknown template {id}");
                }
                throw new WorldError(Code.NoSuchRevision, $"No revision {manifest[id]} of template {id}");
            }
            texts.Add((id + ".json", WorldIO.ReadAllText(path)));
        }
        try
        {
            return TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(texts));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
    }

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
        CheckRequestId(id);
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
        CheckRequestId(id);
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

    // Puts a declaration as the latest, keeping a revision. Answers the
    // revision number, naming the existing one when identical.
    public static long Put(string library, Value.Map template)
    {
        var revs = RevisionsDir(library);
        Directory.CreateDirectory(revs);
        return WorldLock.With(revs, () => PutLocked(library, template));
    }

    private static long PutLocked(string library, Value.Map template)
    {
        TemplateDecl decl;
        try
        {
            var id = template.GetValueOrDefault("id").AsText() ?? "template";
            TemplateShape.Check(template, id);
            decl = ValueJson.Read<TemplateDecl>(template);
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        if (!IsPlainId(decl.Id))
        {
            throw new WorldError(Code.InvalidTemplates, $"Template id {decl.Id} is no plain file name");
        }
        var templatesDir = TemplatesDir(library);
        DeclaredSet current;
        try
        {
            current = Directory.Exists(templatesDir)
                ? TemplateDirectory.ReadDeclarations(templatesDir)
                : new DeclaredSet(
                    new Dictionary<string, TemplateDecl>(StringComparer.Ordinal),
                    new Dictionary<string, string>(StringComparer.Ordinal));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        var decls = new Dictionary<string, TemplateDecl>(current.Decls, StringComparer.Ordinal);
        var sources = new Dictionary<string, string>(current.Sources, StringComparer.Ordinal);
        decls[decl.Id] = decl;
        sources[decl.Id] = "template";
        try
        {
            TemplateResolver.Resolve(new DeclaredSet(decls, sources));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        var canonical = WorldJson.Write(decl);
        var latestPath = LatestPath(library, decl.Id);
        if (File.Exists(latestPath))
        {
            string currentCanonical;
            try
            {
                currentCanonical = CanonicalJson.Serialize(ValueJson.Parse(WorldIO.ReadAllText(latestPath)));
            }
            catch (FormatException error)
            {
                throw new WorldError(Code.InvalidTemplates, $"Unreadable template {decl.Id}: {error.Message}");
            }
            if (string.Equals(currentCanonical, canonical, StringComparison.Ordinal))
            {
                return RecordLocked(library, decl.Id);
            }
        }
        var recorded = RecordLocked(library, decl.Id);
        var next = recorded + 1;
        Directory.CreateDirectory(Path.Combine(RevisionsDir(library), decl.Id));
        WorldWriter.AtomicWrite(RevisionPath(library, decl.Id, next), canonical);
        Directory.CreateDirectory(templatesDir);
        WorldWriter.AtomicWrite(latestPath, canonical);
        return next;
    }

    // Deletes a template from the latest set, keeping its revisions.
    public static void Delete(string library, string id)
    {
        CheckRequestId(id);
        var revs = RevisionsDir(library);
        Directory.CreateDirectory(revs);
        WorldLock.With(revs, () =>
        {
            DeleteLocked(library, id);
            return true;
        });
    }

    private static void DeleteLocked(string library, string id)
    {
        var latestPath = LatestPath(library, id);
        if (!File.Exists(latestPath))
        {
            throw new WorldError(Code.UnknownTemplate, $"Unknown template {id}");
        }
        DeclaredSet current;
        try
        {
            current = TemplateDirectory.ReadDeclarations(TemplatesDir(library));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        if (!current.Decls.ContainsKey(id))
        {
            throw new WorldError(Code.UnknownTemplate, $"Unknown template {id}");
        }
        var decls = new Dictionary<string, TemplateDecl>(current.Decls, StringComparer.Ordinal);
        decls.Remove(id);
        var sources = new Dictionary<string, string>(current.Sources, StringComparer.Ordinal);
        sources.Remove(id);
        try
        {
            TemplateResolver.Resolve(new DeclaredSet(decls, sources));
        }
        catch (FormatException error)
        {
            throw new WorldError(Code.InvalidTemplates, error.Message);
        }
        RecordLocked(library, id);
        File.Delete(latestPath);
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
