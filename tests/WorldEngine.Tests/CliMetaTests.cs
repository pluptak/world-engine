using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Tests;

// The CLI's meta ops (src/cli/main.ts `verbs`, `capabilities`, `catalog` without a world) and the schedule op with its filter, against the
// TypeScript CLI: the requests of Fixtures/cli-meta.expected.json run in order over a copy of store-write in which a beat is queued (the
// same schedule_beat edit the golden made first). Each answer's stdout and status must be the TypeScript CLI's, byte for byte
// (scratchpad/gen/cli-meta-golden.mjs).
public class CliMetaTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");
    private static readonly JsonArray Rows = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "cli-meta.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "climeta-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(scratch, recursive: true);
        }
        catch (IOException)
        {
            // A file a failed test left open is the test's own leftover.
        }
    }

    [Fact]
    public void The_meta_ops_answer_as_the_TypeScript_CLI_does_in_order()
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Golden, dir);
        var queued = JsonNode.Parse(CliRunner.Run([], new JsonObject
        {
            ["op"] = "edit",
            ["world"] = dir,
            ["command_id"] = "beat-b1",
            ["edit"] = new JsonObject
            {
                ["kind"] = "schedule_beat",
                ["id"] = "b1",
                ["at_tick"] = 6,
                ["action"] = new JsonObject { ["kind"] = "sound", ["entity"] = "e4" },
            },
        }.ToJsonString()).Stdout);
        Assert.Equal("ok", queued!["status"]!.GetValue<string>());

        for (var index = 0; index < Rows.Count; index++)
        {
            var row = Rows[index]!;
            var request = (JsonObject)row["request"]!.DeepClone();
            if (request.ContainsKey("world"))
            {
                request["world"] = dir;
            }
            var output = CliRunner.Run([], request.ToJsonString());

            Meaning.Same(row["stdout"]!.GetValue<string>(), output.Stdout, $"row {index} ({request["op"]}): the answer differs from TypeScript's");
            Assert.Equal(row["status"]!.GetValue<int>(), output.Status);
        }
    }

    private static List<string> Files(string root) =>
        [.. Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)];

    private static void CopyTree(string from, string to)
    {
        foreach (var relative in Files(from))
        {
            var target = Path.Combine(to, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(Path.Combine(from, relative), target);
        }
    }
}
