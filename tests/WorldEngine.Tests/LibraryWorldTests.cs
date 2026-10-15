using WorldEngine.Cli;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Library;
using WorldEngine.Store.Templates;

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

    private static Value LabScenario() =>
        ValueJson.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "scenarios", "lab.json")))!;

    private static Dictionary<string, long> ManifestOf(Value.Map manifest) =>
        ((Value.Map)manifest["templates"]).ToDictionary(pair => pair.Key, pair => pair.Value.AsInt()!.Value, StringComparer.Ordinal);

    [Fact]
    public void Add_lab_writes_revision_1_pinning_every_latest_id()
    {
        var lib = CopyTemplatesToTemp();
        var scenario = LabScenario();
        Assert.Equal(1, WorldLibrary.Add(lib, "lab", scenario));
        var got = WorldLibrary.Get(lib, "lab", 1);
        Assert.Equal(CanonicalJson.Serialize(scenario), CanonicalJson.Serialize(got.Scenario));
        var latest = TemplateDirectory.ReadDeclarations(Path.Combine(lib, "templates")).Decls.Keys.Order(StringComparer.Ordinal);
        Assert.Equal(latest, ManifestOf(got.Manifest).Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Pinned_set_is_stable_across_latest_movement_and_edit_pins_new_human()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        var first = ManifestOf(WorldLibrary.Get(lib, "lab", 1).Manifest);
        var hash = TemplateHash.Of(TemplateLibrary.Resolve(lib, first));
        var human = File.ReadAllText(Path.Combine(lib, "templates", "human.json")).Replace("70000", "70001");
        TemplateLibrary.Put(lib, (Value.Map)ValueJson.Parse(human)!);
        Assert.Equal(hash, TemplateHash.Of(TemplateLibrary.Resolve(lib, first)));
        Assert.Equal(2, WorldLibrary.Edit(lib, "lab", LabScenario()));
        var second = ManifestOf(WorldLibrary.Get(lib, "lab", 2).Manifest);
        Assert.True(second["human"] > first["human"]);
    }

    [Fact]
    public void Non_scene_value_is_refused_with_nothing_written()
    {
        var lib = CopyTemplatesToTemp();
        Assert.Equal(Code.InvalidScenario, Assert.Throws<WorldError>(() => WorldLibrary.Add(lib, "bad", "nope")).Code);
        Assert.False(Directory.Exists(Path.Combine(lib, "worlds", "bad")));
    }

    [Fact]
    public void Unknown_template_scenario_writes_no_world()
    {
        // As `init` refuses it: the engine's own error escapes (the goldens pin
        // `internal_error` for it), and no world revision is written for it.
        var lib = CopyTemplatesToTemp();
        Assert.ThrowsAny<Exception>(() => WorldLibrary.Add(lib, "bad", (Value)ValueJson.Parse("""[{"template":"nope"}]""")!));
        Assert.False(Directory.Exists(Path.Combine(lib, "worlds", "bad")));
    }

    [Fact]
    public void Taken_name_is_world_exists()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        Assert.Equal(Code.WorldExists, Assert.Throws<WorldError>(() => WorldLibrary.Add(lib, "lab", LabScenario())).Code);
    }

    [Fact]
    public void Deleted_template_still_resolves_through_a_world()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        TemplateLibrary.Delete(lib, "wine_bottle");
        var got = WorldLibrary.Get(lib, "lab", 1);
        Assert.True(TemplateLibrary.Resolve(lib, ManifestOf(got.Manifest)).ContainsKey("wine_bottle"));
    }

    [Fact]
    public void Get_unknown_name_is_no_such_world_and_bad_world_revision_is_no_such_revision()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        Assert.Equal(Code.NoSuchWorld, Assert.Throws<WorldError>(() => WorldLibrary.Get(lib, "nope", null)).Code);
        Assert.Equal(Code.NoSuchRevision, Assert.Throws<WorldError>(() => WorldLibrary.Get(lib, "lab", 7)).Code);
    }

    [Fact]
    public void Invalid_name_is_invalid_world()
    {
        var lib = CopyTemplatesToTemp();
        Assert.Equal(Code.InvalidWorld, Assert.Throws<WorldError>(() => WorldLibrary.Add(lib, "Lab", LabScenario())).Code);
    }

    private static System.Text.Json.Nodes.JsonNode LabRequest(string lib, string op, string name, System.Text.Json.Nodes.JsonNode? scenario = null, int? revision = null)
    {
        var request = new System.Text.Json.Nodes.JsonObject { ["op"] = op, ["library"] = lib, ["name"] = name };
        if (scenario is not null)
        {
            request["scenario"] = scenario;
        }
        if (revision is not null)
        {
            request["revision"] = revision.Value;
        }
        return request;
    }

    [Fact]
    public void Each_request_through_cli_runner()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "scenarios", "lab.json")))!;

        var added = CliRunner.Run([], LabRequest(lib, "world_add", "lab", lab.DeepClone()).ToJsonString());
        Assert.Equal(0, added.Status);
        Assert.Equal(1, System.Text.Json.Nodes.JsonNode.Parse(added.Stdout)!["revision"]!.GetValue<int>());

        var got = CliRunner.Run([], LabRequest(lib, "world_get", "lab").ToJsonString());
        Assert.Equal(0, got.Status);
        var answered = System.Text.Json.Nodes.JsonNode.Parse(got.Stdout)!;
        Assert.True(answered["scenario"]!["entities"]!.AsArray().Count > 0);
        Assert.NotNull(answered["manifest"]!["templates"]!["human"]);

        var badShape = CliRunner.Run([], LabRequest(lib, "world_add", "bad", System.Text.Json.Nodes.JsonNode.Parse("""[{"id":"x"}]""")!).ToJsonString());
        Assert.Equal(2, badShape.Status);
        Assert.Contains("invalid_scenario", badShape.Stdout);
        Assert.False(Directory.Exists(Path.Combine(lib, "worlds", "bad")));

        var badTemplate = CliRunner.Run([], LabRequest(lib, "world_add", "bad", System.Text.Json.Nodes.JsonNode.Parse("""[{"template":"nope"}]""")!).ToJsonString());
        Assert.Equal(2, badTemplate.Status);
        Assert.Contains("internal_error", badTemplate.Stdout);
        Assert.False(Directory.Exists(Path.Combine(lib, "worlds", "bad")));

        var taken = CliRunner.Run([], LabRequest(lib, "world_add", "lab", lab.DeepClone()).ToJsonString());
        Assert.Equal(2, taken.Status);
        Assert.Contains("world_exists", taken.Stdout);

        var edited = CliRunner.Run([], LabRequest(lib, "world_edit", "lab", lab.DeepClone()).ToJsonString());
        Assert.Equal(0, edited.Status);
        Assert.Equal(2, System.Text.Json.Nodes.JsonNode.Parse(edited.Stdout)!["revision"]!.GetValue<int>());

        var listed = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject { ["op"] = "world_list", ["library"] = lib }.ToJsonString());
        Assert.Equal(0, listed.Status);
        var entry = System.Text.Json.Nodes.JsonNode.Parse(listed.Stdout)!["worlds"]!.AsArray()
            .Single(node => node!["name"]!.GetValue<string>() == "lab");
        Assert.Equal([1, 2], entry!["revisions"]!.AsArray().Select(node => node!.GetValue<int>()));

        var missing = CliRunner.Run([], LabRequest(lib, "world_get", "nope").ToJsonString());
        Assert.Equal(2, missing.Status);
        Assert.Contains("no_such_world", missing.Stdout);

        var missingRev = CliRunner.Run([], LabRequest(lib, "world_get", "lab", revision: 7).ToJsonString());
        Assert.Equal(2, missingRev.Status);
        Assert.Contains("no_such_revision", missingRev.Stdout);
    }

    [Fact]
    public void Corrupt_world_files_are_invalid_world()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        var dir = Path.Combine(lib, "worlds", "lab", "1");
        var manifest = File.ReadAllBytes(Path.Combine(dir, "manifest.json"));
        var scenario = File.ReadAllBytes(Path.Combine(dir, "scenario.json"));

        File.WriteAllText(Path.Combine(dir, "manifest.json"), """{"other":{}}""");
        Assert.Equal(Code.InvalidWorld, Assert.Throws<WorldError>(() => WorldLibrary.Get(lib, "lab", 1)).Code);
        File.WriteAllBytes(Path.Combine(dir, "manifest.json"), manifest);

        File.Delete(Path.Combine(dir, "scenario.json"));
        Assert.Equal(Code.InvalidWorld, Assert.Throws<WorldError>(() => WorldLibrary.Get(lib, "lab", 1)).Code);
        File.WriteAllBytes(Path.Combine(dir, "scenario.json"), scenario);

        File.WriteAllText(Path.Combine(dir, "scenario.json"), "null");
        Assert.Equal(Code.InvalidWorld, Assert.Throws<WorldError>(() => WorldLibrary.Get(lib, "lab", 1)).Code);
        File.WriteAllBytes(Path.Combine(dir, "scenario.json"), scenario);
    }
}
