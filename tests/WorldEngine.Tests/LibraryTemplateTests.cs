using WorldEngine.Cli;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store.Library;
using WorldEngine.Store.Templates;

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

    private static Value.Map Decl(string json) => (Value.Map)ValueJson.Parse(json)!;

    private static Dictionary<string, byte[]> SnapshotBytes(string library)
    {
        var dir = Path.Combine(library, "templates");
        return Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .ToDictionary(
                path => Path.GetRelativePath(dir, path).Replace(Path.DirectorySeparatorChar, '/'),
                File.ReadAllBytes,
                StringComparer.Ordinal);
    }

    [Fact]
    public void Put_werewolf_makes_revision_1_and_directory_reads_it()
    {
        var lib = CopyTemplatesToTemp();
        var rev = TemplateLibrary.Put(lib, Decl("""{"id":"werewolf","extends":"human"}"""));
        Assert.Equal(1, rev);
        Assert.True(TemplateDirectory.ReadDeclarations(Path.Combine(lib, "templates")).Decls.ContainsKey("werewolf"));
        Assert.Equal("werewolf", TemplateLibrary.Get(lib, "werewolf", 1)["id"].AsText());
    }

    [Fact]
    public void Second_put_makes_2_and_get_1_answers_first()
    {
        var lib = CopyTemplatesToTemp();
        TemplateLibrary.Put(lib, Decl("""{"id":"werewolf","extends":"human"}"""));
        var rev2 = TemplateLibrary.Put(lib, Decl("""{"id":"werewolf","extends":"human","mass_g":80000}"""));
        Assert.Equal(2, rev2);
        Assert.False(TemplateLibrary.Get(lib, "werewolf", 1).ContainsKey("mass_g"));
        Assert.Equal(80000, TemplateLibrary.Get(lib, "werewolf", 2)["mass_g"].AsInt());
    }

    [Fact]
    public void Identical_put_makes_none()
    {
        var lib = CopyTemplatesToTemp();
        var first = TemplateLibrary.Put(lib, Decl("""{"id":"werewolf","extends":"human"}"""));
        var again = TemplateLibrary.Put(lib, Decl("""{"id":"werewolf","extends":"human"}"""));
        Assert.Equal(first, again);
        Assert.Equal([first], TemplateLibrary.List(lib).Single(e => e.Id == "werewolf").Revisions);
    }

    [Fact]
    public void Put_unknown_parent_is_invalid_and_bytes_unchanged()
    {
        var lib = CopyTemplatesToTemp();
        var before = SnapshotBytes(lib);
        var error = Assert.Throws<WorldError>(() => TemplateLibrary.Put(lib, Decl("""{"id":"bad","extends":"nope"}""")));
        Assert.Equal(Code.InvalidTemplates, error.Code);
        Assert.Equal(before, SnapshotBytes(lib));
    }

    // An id that is no plain file name could climb out of `templates/`: a put is refused with nothing written anywhere, and a get or
    // delete naming one is refused before any path is made of it.
    [Fact]
    public void An_id_that_is_no_plain_file_name_is_refused()
    {
        var lib = CopyTemplatesToTemp();
        var before = SnapshotBytes(lib);
        var stone = TemplateLibrary.Get(lib, "stone");

        foreach (var id in new[] { "../../outside", "../outside", "a/b", "a\\b", "Stone", ".hidden", "stone." })
        {
            Assert.Equal(Code.InvalidTemplates, Assert.Throws<WorldError>(() => TemplateLibrary.Put(lib, stone.With("id", id))).Code);
            Assert.Equal(Code.InvalidRequest, Assert.Throws<WorldError>(() => TemplateLibrary.Get(lib, id)).Code);
            Assert.Equal(Code.InvalidRequest, Assert.Throws<WorldError>(() => TemplateLibrary.Delete(lib, id)).Code);
        }
        Assert.Equal(before, SnapshotBytes(lib));
        Assert.Empty(Directory.GetFiles(lib, "*.json"));
        Assert.Empty(Directory.GetFiles(scratch, "*.json"));
        Assert.Equal("human.hand_l", TemplateLibrary.Get(lib, "human.hand_l")["id"].AsText());
    }

    [Fact]
    public void Hand_edited_bottle_recorded_before_next_put()
    {
        var lib = CopyTemplatesToTemp();
        var path = Path.Combine(lib, "templates", "bottle.json");
        File.WriteAllText(path, File.ReadAllText(path).Replace("500", "600"));
        var rev = TemplateLibrary.Put(lib, Decl(File.ReadAllText(path).Replace("600", "700")));
        Assert.Equal(2, rev);
        Assert.Equal(600, TemplateLibrary.Get(lib, "bottle", 1)["mass_g"].AsInt());
        Assert.Equal(700, TemplateLibrary.Get(lib, "bottle", 2)["mass_g"].AsInt());
    }

    [Fact]
    public void Delete_bottle_while_wine_bottle_extends_refused()
    {
        var lib = CopyTemplatesToTemp();
        var error = Assert.Throws<WorldError>(() => TemplateLibrary.Delete(lib, "bottle"));
        Assert.Equal(Code.InvalidTemplates, error.Code);
        Assert.True(File.Exists(Path.Combine(lib, "templates", "bottle.json")));
    }

    [Fact]
    public void Delete_wine_bottle_drops_latest_keeps_revisions()
    {
        var lib = CopyTemplatesToTemp();
        TemplateLibrary.Delete(lib, "wine_bottle");
        Assert.False(File.Exists(Path.Combine(lib, "templates", "wine_bottle.json")));
        var entry = TemplateLibrary.List(lib).Single(e => e.Id == "wine_bottle");
        Assert.False(entry.Latest);
        Assert.NotEmpty(entry.Revisions);
        Assert.Equal("wine_bottle", TemplateLibrary.Get(lib, "wine_bottle", entry.Revisions[0])["id"].AsText());
        Assert.False(TemplateDirectory.ReadDeclarations(Path.Combine(lib, "templates")).Decls.ContainsKey("wine_bottle"));
    }

    [Fact]
    public void Each_request_through_cli_runner()
    {
        var lib = CopyTemplatesToTemp();
        string RunJson(System.Text.Json.Nodes.JsonObject request) => CliRunner.Run([], request.ToJsonString()).Stdout;
        int RunStatus(System.Text.Json.Nodes.JsonObject request) => CliRunner.Run([], request.ToJsonString()).Status;

        var listedReq = new System.Text.Json.Nodes.JsonObject { ["op"] = "template_list", ["library"] = lib };
        Assert.Equal(0, RunStatus(listedReq));
        Assert.Contains("bottle", RunJson(listedReq));

        var putReq = new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "template_put",
            ["library"] = lib,
            ["template"] = new System.Text.Json.Nodes.JsonObject { ["id"] = "werewolf", ["extends"] = "human" },
        };
        var putOut = CliRunner.Run([], putReq.ToJsonString());
        Assert.Equal(0, putOut.Status);
        Assert.Contains("revision", putOut.Stdout);
        Assert.Contains("1", putOut.Stdout);

        var getReq = new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "template_get", ["library"] = lib, ["id"] = "werewolf", ["revision"] = 1,
        };
        var got = CliRunner.Run([], getReq.ToJsonString());
        Assert.Equal(0, got.Status);
        Assert.Contains("werewolf", got.Stdout);

        var deleteReq = new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "template_delete", ["library"] = lib, ["id"] = "werewolf",
        };
        Assert.Equal(0, CliRunner.Run([], deleteReq.ToJsonString()).Status);

        var missingReq = new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "template_get", ["library"] = lib, ["id"] = "werewolf",
        };
        var missing = CliRunner.Run([], missingReq.ToJsonString());
        Assert.Equal(2, missing.Status);
        Assert.Contains("unknown_template", missing.Stdout);
    }
}
