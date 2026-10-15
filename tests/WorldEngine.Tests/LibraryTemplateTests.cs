using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Store.Library;

namespace WorldEngine.Tests;

public class LibraryTemplateTests : IDisposable
{
    private readonly string scratch = Path.Combine(Path.GetTempPath(), "libtmpl-" + Guid.NewGuid().ToString("N"));

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

    private static string RepoTemplates()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(root.FullName, "WorldEngine.slnx")))
        {
            root = root.Parent!;
        }
        return Path.Combine(root.FullName, "templates");
    }

    private string CopyTemplatesToTemp()
    {
        var library = Path.Combine(scratch, Guid.NewGuid().ToString("N"));
        var target = Path.Combine(library, "templates");
        Directory.CreateDirectory(target);
        foreach (var path in Directory.EnumerateFiles(RepoTemplates(), "*.json"))
        {
            File.Copy(path, Path.Combine(target, Path.GetFileName(path)));
        }
        return library;
    }

    [Fact]
    public void List_of_temp_copy_names_every_id_by_id()
    {
        var lib = CopyTemplatesToTemp();
        var list = TemplateLibrary.List(lib);
        Assert.Equal(
            list.OrderBy(e => e.Id, StringComparer.Ordinal).Select(e => e.Id),
            list.Select(e => e.Id));
        Assert.Contains(list, e => e.Id == "bottle" && e.Latest && e.Revisions.Count == 0);
    }

    [Fact]
    public void Get_latest_answers_bottle_declaration()
    {
        var lib = CopyTemplatesToTemp();
        var got = TemplateLibrary.Get(lib, "bottle", null);
        Assert.Equal("bottle", got["id"].AsText());
    }

    [Fact]
    public void Get_unknown_id_is_unknown_template()
    {
        var lib = CopyTemplatesToTemp();
        Assert.Equal(Code.UnknownTemplate, Assert.Throws<WorldError>(() => TemplateLibrary.Get(lib, "nope", null)).Code);
    }

    [Fact]
    public void Get_missing_revision_is_no_such_revision()
    {
        var lib = CopyTemplatesToTemp();
        Assert.Equal(Code.NoSuchRevision, Assert.Throws<WorldError>(() => TemplateLibrary.Get(lib, "bottle", 1)).Code);
    }
}
