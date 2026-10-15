using WorldEngine.Cli;
using WorldEngine.Contract;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Library;

namespace WorldEngine.Tests;

public class LibraryRunTests : IDisposable
{
    private readonly string scratch = Path.Combine(Path.GetTempPath(), "librun-" + Guid.NewGuid().ToString("N"));

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
    public void Delete_world_removes_worlds_and_runs()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        var runDir = MakeRun(lib, "lab", 1, "r1");

        var lockPath = Path.Combine(runDir, "lock");
        File.WriteAllText(
            lockPath,
            """{"pid":""" + Environment.ProcessId + ""","since_ms":""" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ""","nonce":"test"}""");
        Environment.SetEnvironmentVariable("WORLD_LOCK_TIMEOUT_MS", "100");
        try
        {
            Assert.Equal(
                Code.StoreBusy,
                Assert.Throws<WorldError>(() => WorldLibrary.Delete(lib, "lab")).Code);
            Assert.True(Directory.Exists(Path.Combine(lib, "worlds", "lab")));
        }
        finally
        {
            Environment.SetEnvironmentVariable("WORLD_LOCK_TIMEOUT_MS", null);
            File.Delete(lockPath);
        }

        WorldLibrary.Delete(lib, "lab");
        Assert.False(Directory.Exists(Path.Combine(lib, "worlds", "lab")));
        Assert.False(Directory.Exists(Path.Combine(lib, "runs", "lab")));
        Assert.Equal(Code.NoSuchWorld, Assert.Throws<WorldError>(() => WorldLibrary.Get(lib, "lab", 1)).Code);
        Assert.Equal(Code.NoSuchWorld, Assert.Throws<WorldError>(() => WorldLibrary.Delete(lib, "lab")).Code);
    }

    [Fact]
    public void DeleteRevision_pinned_is_refused_then_succeeds_after_world_delete()
    {
        var lib = CopyTemplatesToTemp();
        WorldLibrary.Add(lib, "lab", LabScenario());
        var first = ManifestOf(WorldLibrary.Get(lib, "lab", 1).Manifest)["human"];
        MakeRun(lib, "lab", 1, "r1");
        var human = File.ReadAllText(Path.Combine(lib, "templates", "human.json")).Replace("70000", "70001");
        TemplateLibrary.Put(lib, (Value.Map)ValueJson.Parse(human)!);

        Assert.Equal(Code.RevisionInUse, Assert.Throws<WorldError>(() => TemplateLibrary.DeleteRevision(lib, "human", first)).Code);

        WorldLibrary.Delete(lib, "lab");
        TemplateLibrary.DeleteRevision(lib, "human", first);
        Assert.Equal(Code.NoSuchRevision, Assert.Throws<WorldError>(() => TemplateLibrary.Get(lib, "human", first)).Code);

        Assert.Equal(Code.NoSuchRevision, Assert.Throws<WorldError>(() => TemplateLibrary.DeleteRevision(lib, "human", 77)).Code);
        Assert.Equal(Code.UnknownTemplate, Assert.Throws<WorldError>(() => TemplateLibrary.DeleteRevision(lib, "nope", 1)).Code);
        Assert.Equal(Code.InvalidRequest, Assert.Throws<WorldError>(() => TemplateLibrary.DeleteRevision(lib, "../outside", 1)).Code);
    }

    private string MakeRun(string library, string world, long revision, string run)
    {
        var data = WorldLibrary.Get(library, world, revision);
        var registry = TemplateLibrary.Resolve(library, ManifestOf(data.Manifest));
        var made = WorldBuilder.Snapshot(data.Scenario, registry);
        var manifest = Value.Map.Empty
            .With("world", world)
            .With("world_revision", revision)
            .With("templates", data.Manifest["templates"]);
        var dir = Path.Combine(library, "runs", world, run);
        WorldBuilder.Create(dir, made.Snapshot, made.Ids, manifest);
        return dir;
    }

    [Fact]
    public void Corrupt_run_answers_invalid_templates()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(LabText())!;
        Assert.Equal(0, CliRunner.Run([], CliRequest("world_add", lib,
            ("name", "lab"), ("scenario", lab.DeepClone())).ToJsonString()).Status);
        var first = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"), ("run", "r1")).ToJsonString());
        Assert.Equal(0, first.Status);
        var firstDir = System.Text.Json.Nodes.JsonNode.Parse(first.Stdout)!["run"]!.GetValue<string>();

        File.Delete(Path.Combine(firstDir, "manifest.json"));
        var snapshot = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "snapshot",
            ["world"] = firstDir,
        }.ToJsonString());
        Assert.Equal(2, snapshot.Status);
        Assert.Contains("invalid_templates", snapshot.Stdout);
    }

    [Fact]
    public void Run_with_deleted_revision_answers_invalid_templates()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(LabText())!;
        Assert.Equal(0, CliRunner.Run([], CliRequest("world_add", lib,
            ("name", "lab"), ("scenario", lab.DeepClone())).ToJsonString()).Status);
        var first = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"), ("run", "r1")).ToJsonString());
        Assert.Equal(0, first.Status);
        var firstDir = System.Text.Json.Nodes.JsonNode.Parse(first.Stdout)!["run"]!.GetValue<string>();

        var pins = ManifestOf(WorldLibrary.Get(lib, "lab", 1).Manifest);
        File.Delete(Path.Combine(lib, "templates", ".revisions", "human", pins["human"] + ".json"));
        var snapshot = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "snapshot",
            ["world"] = firstDir,
        }.ToJsonString());
        Assert.Equal(2, snapshot.Status);
        Assert.Contains("invalid_templates", snapshot.Stdout);
    }

    [Fact]
    public void Run_start_use_names_a_revision_or_latest()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(LabText())!;
        Assert.Equal(0, CliRunner.Run([], CliRequest("world_add", lib,
            ("name", "lab"), ("scenario", lab.DeepClone())).ToJsonString()).Status);
        Assert.Equal(0, CliRunner.Run([], CliRequest("template_put", lib,
            ("template", System.Text.Json.Nodes.JsonNode.Parse("""{"id":"werewolf","extends":"human"}""")!)).ToJsonString()).Status);

        var added = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"),
            ("run", "r1"),
            ("use", new System.Text.Json.Nodes.JsonObject { ["werewolf"] = "latest" })).ToJsonString());
        Assert.Equal(0, added.Status);
        var addedDir = System.Text.Json.Nodes.JsonNode.Parse(added.Stdout)!["run"]!.GetValue<string>();
        var manifest = (Value.Map)ValueJson.Parse(File.ReadAllText(Path.Combine(addedDir, "manifest.json")))!;
        var pins = manifest["templates"];
        Assert.Equal(1, ((Value.Map)pins)["werewolf"].AsInt());
        var expected = ManifestOf(WorldLibrary.Get(lib, "lab", 1).Manifest);
        expected["werewolf"] = 1;
        Assert.Equal(
            TemplateHash.Of(TemplateLibrary.Resolve(lib, expected)),
            StoreWorld.Open(addedDir).CurrentSnapshot().TemplatesHash);

        foreach (var use in new System.Text.Json.Nodes.JsonObject[]
        {
            new() { ["nope"] = 2 },
            new() { ["human"] = "yes" },
            new() { ["../outside"] = "latest" },
        })
        {
            var refused = CliRunner.Run([], CliRequest("run_start", lib,
                ("world", "lab"), ("run", "rx"), ("use", use)).ToJsonString());
            Assert.Equal(2, refused.Status);
            Assert.Contains("invalid_templates", refused.Stdout);
        }
    }

    private static System.Text.Json.Nodes.JsonObject CliRequest(string op, string library, params (string Key, System.Text.Json.Nodes.JsonNode? Value)[] fields)
    {
        var request = new System.Text.Json.Nodes.JsonObject { ["op"] = op, ["library"] = library };
        foreach (var (key, value) in fields)
        {
            request[key] = value;
        }
        return request;
    }

    private static string LabText() => File.ReadAllText(Path.Combine(RepoRoot(), "scenarios", "lab.json"));

    [Fact]
    public void Started_run_matches_init_snapshot_and_hash()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(LabText())!;
        Assert.Equal(0, CliRunner.Run([], CliRequest("world_add", lib,
            ("name", "lab"), ("scenario", lab.DeepClone())).ToJsonString()).Status);

        var started = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"), ("run", "r1")).ToJsonString());
        Assert.Equal(0, started.Status);
        var runDir = System.Text.Json.Nodes.JsonNode.Parse(started.Stdout)!["run"]!.GetValue<string>();
        Assert.Equal(Path.Combine(lib, "runs", "lab", "r1"), runDir);

        var data = WorldLibrary.Get(lib, "lab", 1);
        var made = WorldBuilder.Snapshot(data.Scenario, TemplateLibrary.Resolve(lib, ManifestOf(data.Manifest)));
        var opened = StoreWorld.Open(runDir).CurrentSnapshot();
        Assert.Equal(WorldWriter.Canonical(made.Snapshot), WorldWriter.Canonical(opened));
        Assert.Equal(made.Snapshot.TemplatesHash, opened.TemplatesHash);

        var command = new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "command",
            ["world"] = runDir,
            ["command"] = new System.Text.Json.Nodes.JsonObject
            {
                ["command_id"] = "c1",
                ["actor"] = opened.Entities.First(pair => pair.Value.Name == "ann").Key,
                ["verb"] = "wait",
                ["args"] = new System.Text.Json.Nodes.JsonObject { ["ticks"] = 1 },
            },
        };
        var answered = CliRunner.Run([], command.ToJsonString());
        Assert.Equal(0, answered.Status);
        Assert.Contains("\"status\":\"ok\"", answered.Stdout);

        var verify = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "verify",
            ["world"] = runDir,
        }.ToJsonString());
        Assert.Equal(0, verify.Status);
        Assert.Contains("\"ok\":true", verify.Stdout);
    }

    [Fact]
    public void Plan_lists_newer_and_second_run_uses_latest()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(LabText())!;
        Assert.Equal(0, CliRunner.Run([], CliRequest("world_add", lib,
            ("name", "lab"), ("scenario", lab.DeepClone())).ToJsonString()).Status);
        var first = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"), ("run", "r1")).ToJsonString());
        Assert.Equal(0, first.Status);
        var firstDir = System.Text.Json.Nodes.JsonNode.Parse(first.Stdout)!["run"]!.GetValue<string>();
        var firstHash = StoreWorld.Open(firstDir).CurrentSnapshot().TemplatesHash;

        var human = File.ReadAllText(Path.Combine(lib, "templates", "human.json")).Replace("70000", "70001");
        var put = CliRunner.Run([], CliRequest("template_put", lib,
            ("template", System.Text.Json.Nodes.JsonNode.Parse(human)!)).ToJsonString());
        Assert.Equal(0, put.Status);
        var putWolf = CliRunner.Run([], CliRequest("template_put", lib,
            ("template", System.Text.Json.Nodes.JsonNode.Parse("""{"id":"werewolf","extends":"human"}""")!)).ToJsonString());
        Assert.Equal(0, putWolf.Status);

        var plan = CliRunner.Run([], CliRequest("run_plan", lib, ("world", "lab")).ToJsonString());
        Assert.Equal(0, plan.Status);
        var planned = System.Text.Json.Nodes.JsonNode.Parse(plan.Stdout)!;
        var newer = planned["newer"]!.AsArray().Single(node => node!["template"]!.GetValue<string>() == "human");
        Assert.Equal(1, newer!["pinned"]!.GetValue<int>());
        Assert.Equal(2, newer!["latest"]!.GetValue<int>());
        Assert.Contains(planned["added"]!.AsArray(), node => node!.GetValue<string>() == "werewolf");

        var second = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"),
            ("run", "r2"),
            ("use", new System.Text.Json.Nodes.JsonObject { ["human"] = "latest" })).ToJsonString());
        Assert.Equal(0, second.Status);
        var secondDir = System.Text.Json.Nodes.JsonNode.Parse(second.Stdout)!["run"]!.GetValue<string>();
        var pins = ManifestOf(WorldLibrary.Get(lib, "lab", 1).Manifest);
        pins["human"] = 2;
        var expected = TemplateHash.Of(TemplateLibrary.Resolve(lib, pins));
        Assert.Equal(expected, StoreWorld.Open(secondDir).CurrentSnapshot().TemplatesHash);
        Assert.NotEqual(firstHash, StoreWorld.Open(secondDir).CurrentSnapshot().TemplatesHash);

        var third = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"),
            ("revision", 1),
            ("run", "r3"),
            ("use", new System.Text.Json.Nodes.JsonObject { ["human"] = 2 })).ToJsonString());
        Assert.Equal(0, third.Status);

        var again = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"), ("run", "r1")).ToJsonString());
        Assert.Equal(2, again.Status);
        Assert.Contains("world_exists", again.Stdout);

        var verify = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "verify",
            ["world"] = firstDir,
        }.ToJsonString());
        Assert.Equal(0, verify.Status);
        Assert.Contains("\"ok\":true", verify.Stdout);
    }

    [Fact]
    public void Each_run_request_through_cli_runner()
    {
        var lib = CopyTemplatesToTemp();
        var lab = System.Text.Json.Nodes.JsonNode.Parse(LabText())!;
        Assert.Equal(0, CliRunner.Run([], CliRequest("world_add", lib,
            ("name", "lab"), ("scenario", lab.DeepClone())).ToJsonString()).Status);
        var first = CliRunner.Run([], CliRequest("run_start", lib,
            ("world", "lab"), ("run", "r1")).ToJsonString());
        Assert.Equal(0, first.Status);
        var firstDir = System.Text.Json.Nodes.JsonNode.Parse(first.Stdout)!["run"]!.GetValue<string>();

        var listed = CliRunner.Run([], CliRequest("run_list", lib, ("world", "lab")).ToJsonString());
        Assert.Equal(0, listed.Status);
        var entry = System.Text.Json.Nodes.JsonNode.Parse(listed.Stdout)!["runs"]!.AsArray()
            .Single(node => node!["run"]!.GetValue<string>() == "r1");
        Assert.Equal(1, entry!["world_revision"]!.GetValue<int>());

        var missing = CliRunner.Run([], CliRequest("run_list", lib, ("world", "nope")).ToJsonString());
        Assert.Equal(2, missing.Status);
        Assert.Contains("no_such_world", missing.Stdout);

        var missingRev = CliRunner.Run([], CliRequest("run_plan", lib, ("world", "lab"), ("revision", 7)).ToJsonString());
        Assert.Equal(2, missingRev.Status);
        Assert.Contains("no_such_revision", missingRev.Stdout);

        var badRun = CliRunner.Run([], CliRequest("run_start", lib, ("world", "lab"), ("run", "R1")).ToJsonString());
        Assert.Equal(2, badRun.Status);
        Assert.Contains("invalid_world", badRun.Stdout);

        var inside = Path.Combine(lib, "runs", "lab", "r2");
        var restarted = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "restart",
            ["world"] = firstDir,
            ["to"] = inside,
        }.ToJsonString());
        Assert.Equal(0, restarted.Status);
        Assert.Equal(
            File.ReadAllText(Path.Combine(firstDir, "manifest.json")),
            File.ReadAllText(Path.Combine(inside, "manifest.json")));

        var outside = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "restart",
            ["world"] = firstDir,
            ["to"] = Path.Combine(scratch, "elsewhere"),
        }.ToJsonString());
        Assert.Equal(2, outside.Status);
        Assert.Contains("outside_library", outside.Stdout);

        var pinned = CliRunner.Run([], CliRequest("template_revision_delete", lib,
            ("id", "human"), ("revision", 1)).ToJsonString());
        Assert.Equal(2, pinned.Status);
        Assert.Contains("revision_in_use", pinned.Stdout);

        var deleted = CliRunner.Run([], CliRequest("world_delete", lib, ("name", "lab")).ToJsonString());
        Assert.Equal(0, deleted.Status);
        var gone = CliRunner.Run([], new System.Text.Json.Nodes.JsonObject
        {
            ["op"] = "snapshot",
            ["world"] = firstDir,
        }.ToJsonString());
        Assert.Equal(2, gone.Status);
        Assert.Contains("no_such_world", gone.Stdout);

        var missingWorld = CliRunner.Run([], CliRequest("world_delete", lib, ("name", "lab")).ToJsonString());
        Assert.Equal(2, missingWorld.Status);
        Assert.Contains("no_such_world", missingWorld.Stdout);

        var badName = CliRunner.Run([], CliRequest("world_delete", lib, ("name", "Lab")).ToJsonString());
        Assert.Equal(2, badName.Status);
        Assert.Contains("invalid_world", badName.Stdout);
    }

    private static Value LabScenario() =>
        ValueJson.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "scenarios", "lab.json")))!;

    private static Dictionary<string, long> ManifestOf(Value.Map manifest) =>
        ((Value.Map)manifest["templates"]).ToDictionary(pair => pair.Key, pair => pair.Value.AsInt()!.Value, StringComparer.Ordinal);

    [Fact]
    public void Restart_of_linked_run_keeps_manifest_and_outside_is_refused()
    {
        var lib = CopyTemplatesToTemp();
        var scenario = LabScenario();
        WorldLibrary.Add(lib, "lab", scenario);
        var data = WorldLibrary.Get(lib, "lab", 1);
        var pins = ManifestOf(data.Manifest);
        var registry = TemplateLibrary.Resolve(lib, pins);
        var made = WorldBuilder.Snapshot(scenario, registry);
        var manifest = Value.Map.Empty
            .With("world", "lab")
            .With("world_revision", 1L)
            .With("templates", data.Manifest["templates"]);
        var runDir = Path.Combine(lib, "runs", "lab", "r1");
        WorldBuilder.Create(runDir, made.Snapshot, made.Ids, manifest);

        var inside = Path.Combine(lib, "runs", "lab", "r2");
        WorldBuilder.Restart(runDir, inside);
        Assert.Equal(
            CanonicalJson.Serialize(manifest),
            CanonicalJson.Serialize(ValueJson.Parse(File.ReadAllText(Path.Combine(inside, "manifest.json")))));

        var outside = Path.Combine(scratch, "elsewhere");
        Assert.Equal(
            Code.OutsideLibrary,
            Assert.Throws<WorldError>(() => WorldBuilder.Restart(runDir, outside)).Code);
    }

    [Fact]
    public void Request_shapes_for_runs_exist()
    {
        Assert.Equal("revision_in_use", WorldJson.Name(Code.RevisionInUse));
        Assert.Equal("outside_library", WorldJson.Name(Code.OutsideLibrary));
        foreach (var json in new[]
        {
            """{"op":"run_plan","library":"l","world":"w"}""",
            """{"op":"run_start","library":"l","world":"w","run":"r"}""",
            """{"op":"run_list","library":"l","world":"w"}""",
            """{"op":"world_delete","library":"l","name":"w"}""",
            """{"op":"template_revision_delete","library":"l","id":"human","revision":1}""",
        })
        {
            Assert.True(Checks.IsRequest(ValueJson.Parse(json)), json);
        }
    }
}
