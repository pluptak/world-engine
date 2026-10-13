using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Tests;

// The CLI's player and director ops (src/cli/main.ts `player_*`, `director_*`) against the TypeScript CLI: the requests of
// Fixtures/cli-player.expected.json run in order over one copy of the store-run world (a running run with two registered players), each
// answer's stdout and status the TypeScript CLI's, byte for byte. The pending.json the requests leave must be the TypeScript one too
// (scratchpad/gen/cli-player-golden.mjs).
public class CliPlayerTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-run");
    private static readonly JsonArray Rows = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "cli-player.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "cliplayer-" + Guid.NewGuid().ToString("N"));

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
    public void The_player_and_director_ops_answer_as_the_TypeScript_CLI_does_in_order()
    {
        Assert.NotEmpty(Rows);
        var dir = Path.Combine(scratch, "world");
        CopyTree(Golden, dir);

        for (var index = 0; index < Rows.Count; index++)
        {
            var row = Rows[index]!;
            var request = (JsonObject)row["request"]!.DeepClone();
            request["world"] = dir;
            var output = CliRunner.Run([], request.ToJsonString());

            Assert.True(
                row["stdout"]!.GetValue<string>() == output.Stdout,
                $"row {index} ({request["op"]}): the answer differs from TypeScript's");
            Assert.Equal(row["status"]!.GetValue<int>(), output.Status);
        }
    }

    [Fact]
    public void The_pending_file_is_the_one_TypeScript_leaves()
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Golden, dir);
        foreach (var row in Rows)
        {
            var request = (JsonObject)row!["request"]!.DeepClone();
            request["world"] = dir;
            CliRunner.Run([], request.ToJsonString());
        }

        var expected = File.ReadAllText(Path.Combine(Fixtures, "cli-player.pending.expected.json"));
        Assert.Equal(expected, File.ReadAllText(Path.Combine(dir, "pending.json")));
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
