using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Tests;

// The CLI's write ops (src/cli/main.ts `command`, `edit`) against the TypeScript CLI: the requests of Fixtures/cli-write.expected.json run
// in order over one copy of the store-write world, each changing what the next one sees. Every answer's stdout and exit status must be the
// TypeScript CLI's, byte for byte (scratchpad/gen/cli-write-golden.mjs).
public class CliWriteTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");
    private static readonly JsonArray Rows = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "cli-write.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "cliwrite-" + Guid.NewGuid().ToString("N"));

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
    public void The_write_ops_answer_as_the_TypeScript_CLI_does_in_order()
    {
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

    private static List<string> Files(string root) =>
        Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)
            .ToList();

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
