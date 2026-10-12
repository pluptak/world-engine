using System.Diagnostics;
using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Tests;

// The CLI's read ops (src/cli/main.ts `runCli`) against the TypeScript CLI: each request of Fixtures/cli-read.expected.json is run over a copy
// of the store-write world, and the stdout and exit status must be the TypeScript CLI's, byte for byte. A request names its world by the
// placeholder {WORLD} (the copy) or {MISSING} (a directory that is no world).
public class CliReadTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");
    private static readonly JsonArray Rows = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "cli-read.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "cliread-" + Guid.NewGuid().ToString("N"));

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

    public static IEnumerable<object[]> RowIndexes() => Enumerable.Range(0, Rows.Count).Select(index => new object[] { index });

    [Theory]
    [MemberData(nameof(RowIndexes))]
    public void The_read_ops_answer_as_the_TypeScript_CLI_does(int index)
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Golden, dir);
        var row = Rows[index]!;

        var input = row["request"] is JsonObject request
            ? RequestText(request, dir)
            : "{";
        var output = CliRunner.Run([], input);

        Assert.Equal(row["stdout"]!.GetValue<string>(), output.Stdout);
        Assert.Equal(row["status"]!.GetValue<int>(), output.Status);
    }

    [Fact]
    public void The_command_line_answers_on_standard_output_and_exits_with_the_status()
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Golden, dir);
        var verify = Rows.Single(row => row!["request"] is JsonObject request && request["op"]!.GetValue<string>() == "verify")!;
        var refused = Rows.Single(row => row!["request"] is JsonObject request && request["world"]!.GetValue<string>() == "{MISSING}")!;

        var answered = Run(new JsonObject { ["op"] = "verify", ["world"] = dir }.ToJsonString());
        var declined = Run(new JsonObject { ["op"] = "snapshot", ["world"] = Path.Combine(scratch, "none") }.ToJsonString());

        Assert.Equal(verify["stdout"]!.GetValue<string>(), answered.Stdout);
        Assert.Equal(0, answered.Status);
        Assert.Equal(refused["stdout"]!.GetValue<string>(), declined.Stdout);
        Assert.Equal(2, declined.Status);
    }

    // Runs the compiled command line with `input` on standard input, as a caller in another process would.
    private static (string Stdout, int Status) Run(string input)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
        };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "WorldEngine.Cli.dll"));
        using var process = Process.Start(start) ?? throw new InvalidOperationException("The command line did not start");
        process.StandardInput.Write(input);
        process.StandardInput.Close();
        var stdout = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        return (stdout, process.ExitCode);
    }

    // The request with its world filled in from the placeholder: the copy, or a directory that is no world.
    private string RequestText(JsonObject request, string dir)
    {
        var copy = (JsonObject)request.DeepClone();
        copy["world"] = copy["world"]!.GetValue<string>() == "{WORLD}" ? dir : Path.Combine(scratch, "none");
        return copy.ToJsonString();
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
