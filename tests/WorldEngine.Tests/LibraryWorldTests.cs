using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Store.Library;

namespace WorldEngine.Tests;

public class LibraryWorldTests : IDisposable
{
    private readonly string scratch = Path.Combine(Path.GetTempPath(), "libworld-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(scratch, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private static string RepoRoot()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(root.FullName, "WorldEngine.slnx")))
        {
            root = root.Parent!;
        }
        return root.FullName;
    }

    private string CopyTemplatesToTemp()
    {
        var library = Path.Combine(scratch, Guid.NewGuid().ToString("N"));
        var target = Path.Combine(library, "templates");
        Directory.CreateDirectory(target);
        foreach (var path in Directory.EnumerateFiles(Path.Combine(RepoRoot(), "templates"), "*.json"))
        {
            File.Copy(path, Path.Combine(target, Path.GetFileName(path)));
        }
        return library;
    }

    [Fact]
    public void Resolve_of_recorded_revisions_answers_their_registry()
    {
        var lib = CopyTemplatesToTemp();
        var rev = TemplateLibrary.Record(lib, "stone");
        var registry = TemplateLibrary.Resolve(lib, new Dictionary<string, long> { ["stone"] = rev });
        Assert.Equal("stone", registry["stone"].Id);
    }

    [Fact]
    public void Resolve_of_an_unrecorded_revision_is_no_such_revision()
    {
        var lib = CopyTemplatesToTemp();
        Assert.Equal(Code.NoSuchRevision, Assert.Throws<WorldError>(() =>
            TemplateLibrary.Resolve(lib, new Dictionary<string, long> { ["bottle"] = 7 })).Code);
    }

    [Fact]
    public void Resolve_of_an_unknown_id_is_unknown_template()
    {
        var lib = CopyTemplatesToTemp();
        Assert.Equal(Code.UnknownTemplate, Assert.Throws<WorldError>(() =>
            TemplateLibrary.Resolve(lib, new Dictionary<string, long> { ["nope"] = 1 })).Code);
    }
}
