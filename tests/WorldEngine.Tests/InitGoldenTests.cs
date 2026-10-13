using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Tests;

// The CLI's init and restart ops (src/cli/main.ts `initializeWorld`, `restartWorld`) against TypeScript: each row of Fixtures/init.expected
// .json (scratchpad/gen/init-golden.mjs) gives the same answer, and every world made is the same files byte for byte as TypeScript's
// (Fixtures/init/<name>/). {DIR} is the world's directory, {SCN} the scenario folder, and in restart rows {WORLD}, {TO} and {MISSING}.
public class InitGoldenTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Scenarios = Path.Combine(Fixtures, "init-scenarios");
    private static readonly JsonArray Rows = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "init.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "cliinit-" + Guid.NewGuid().ToString("N"));

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
    public void The_init_op_answers_and_makes_the_worlds_as_TypeScript_does()
    {
        foreach (var row in Rows.Where(row => row!["argv"] is not null).Select(row => row!))
        {
            var name = row["name"]?.GetValue<string>();
            var dir = Path.Combine(scratch, name ?? "unnamed");
            var argv = row["argv"]!.AsArray().Select(node => Substitute(node!.GetValue<string>(), dir)).ToList();

            var output = CliRunner.Run(argv, "");

            Assert.Equal(row["status"]!.GetValue<int>(), output.Status);
            // A scenario or coverage that Zod refuses is answered with Zod's own issues, which the command line does not reproduce: the
            // status is the same, and the issue list is the one place the two differ (docs in the report, not the golden).
            if (ListsZodIssues(row["stdout"]!.GetValue<string>()))
            {
                Assert.Contains("\"status\":\"invalid\"", output.Stdout);
                continue;
            }
            var expected = row["stdout"]!.GetValue<string>().Replace("{DIR}", Escape(dir));
            Assert.True(expected == output.Stdout, $"{name ?? string.Join(' ', argv)}: the answer differs from TypeScript's");
            if (name is not null && output.Status == 0)
            {
                CompareFiles(Path.Combine(Fixtures, "init", name), dir, name);
            }
        }
    }

    [Fact]
    public void The_restart_op_answers_and_makes_the_world_as_TypeScript_does()
    {
        var source = Path.Combine(scratch, "restart-source");
        var restarted = Path.Combine(scratch, "restarted");
        var missing = Path.Combine(scratch, "none");
        CopyTree(Path.Combine(Fixtures, "init", "lab-run"), source);

        foreach (var row in Rows.Where(row => row!["request"] is not null).Select(row => row!))
        {
            var request = (JsonObject)row["request"]!.DeepClone();
            request["world"] = request["world"]!.GetValue<string>() switch
            {
                "{WORLD}" => source,
                "{MISSING}" => missing,
                var other => other,
            };
            request["to"] = request["to"]!.GetValue<string>() switch
            {
                "{TO}" => restarted,
                "{WORLD}" => source,
                var other => other,
            };

            var output = CliRunner.Run([], request.ToJsonString());

            var expected = row["stdout"]!.GetValue<string>()
                .Replace("{WORLD}", Escape(source))
                .Replace("{TO}", Escape(restarted))
                .Replace("{MISSING}", Escape(missing));
            Assert.True(expected == output.Stdout, $"restart {request["to"]}: the answer differs from TypeScript's");
            Assert.Equal(row["status"]!.GetValue<int>(), output.Status);
        }

        CompareFiles(Path.Combine(Fixtures, "init", "restart"), restarted, "restart");
    }

    // Whether an answer lists an issue Zod made (a field's type, size, or key set), rather than one of the command line's own codes.
    private static bool ListsZodIssues(string answer)
    {
        var zodCodes = new[] { "invalid_type", "too_small", "too_big", "unrecognized_keys", "invalid_union", "invalid_value" };
        return JsonNode.Parse(answer)!["issues"] is JsonArray issues
            && issues.Any(issue => zodCodes.Contains(issue!["code"]!.GetValue<string>()));
    }

    // A placeholder in a request's argument, filled in for this run.
    private string Substitute(string text, string dir) =>
        text.Replace("{SCN}", Scenarios + Path.DirectorySeparatorChar).Replace("{DIR}", dir);

    // A path as a canonical answer writes it: with its backslashes escaped.
    private static string Escape(string path) => path.Replace("\\", "\\\\");

    // The world made in `actual` holds the same files as TypeScript's, each byte for byte.
    private static void CompareFiles(string expected, string actual, string name)
    {
        Assert.True(Directory.Exists(actual), $"{name}: no world was made at {actual}");
        var expectedFiles = Files(expected);
        Assert.Equal(expectedFiles, Files(actual));
        foreach (var relative in expectedFiles)
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(expected, relative)).SequenceEqual(File.ReadAllBytes(Path.Combine(actual, relative))),
                $"{name}: {relative} differs from TypeScript's");
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
