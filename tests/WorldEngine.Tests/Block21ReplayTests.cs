using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Tests;

// Block 21 (the plan's parity phase): the TypeScript acceptance and scenario sequences that drive a stored world or the command line,
// recorded from the test files as the requests they make (scratchpad/gen/block21), replayed here through the .NET command line in order.
// Every answer must be the TypeScript command line's, byte for byte, and every world made must hold the same files, each with the same
// hash (Fixtures/block21/golden.json, from the same trace replayed through TypeScript). Placeholders: {TMP} is the replay's scratch
// directory, {ROOT} the folder holding the scenario files (Fixtures/block21/root).
public class Block21ReplayTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures", "block21");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "b21-net-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(scratch, recursive: true);
        }
        catch (IOException)
        {
            // A file a failed run left open is the run's own leftover.
        }
    }

    [Fact]
    public void The_recorded_requests_answer_and_write_as_TypeScript_does()
    {
        var golden = (JsonObject)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "golden.json")))!;
        var rows = (JsonArray)golden["rows"]!;
        var manifest = (JsonObject)golden["manifest"]!;
        var trace = File.ReadAllLines(Path.Combine(Fixtures, "trace.jsonl"))
            .Where(line => line.Length > 0)
            .Select(line => (JsonObject)JsonNode.Parse(line)!)
            .ToList();
        Assert.Equal(rows.Count, trace.Count);

        var replay = new Replay(Path.Combine(scratch, "replay"), Path.Combine(Fixtures, "root"));
        // Each request touches one world (the first folder under {TMP}), and no request reads another world, so the worlds replay in
        // parallel, each in its recorded order. Mismatches are reported in request order.
        var found = new string?[trace.Count];
        var worlds = Enumerable.Range(0, trace.Count).GroupBy(index => WorldOf(trace[index])).ToList();
        Parallel.ForEach(worlds, world =>
        {
            foreach (var index in world)
            {
                found[index] = Answer(replay, trace[index], index, rows[index]!);
            }
        });
        var mismatches = found.OfType<string>().ToList();

        foreach (var (placeholder, files) in manifest)
        {
            var mismatch = CompareWorld(replay.Into(placeholder), (JsonObject)files!);
            if (mismatch is not null)
            {
                mismatches.Add($"{placeholder}: {mismatch}");
            }
        }
        Assert.True(mismatches.Count == 0, $"{mismatches.Count} mismatches, first: {string.Join("; ", mismatches.Take(10))}");
    }

    // One recorded request through the command line: null when it answers as TypeScript's did, else what differs.
    private static string? Answer(Replay replay, JsonObject line, int index, JsonNode expected)
    {
        var kind = line["kind"]!.GetValue<string>();
        CliOutput output;
        if (kind == "init")
        {
            var args = new List<string> { "init", replay.Into(line["dir"]!.GetValue<string>()), replay.Scene(index, line["scene"]!) };
            if (line["coverage"] is JsonNode coverage)
            {
                args.Add(replay.Coverage(index, coverage));
            }
            output = CliRunner.Run(args, "");
        }
        else if (kind == "cli")
        {
            var args = line["args"]!.AsArray().Select(arg => replay.Into(arg!.GetValue<string>())).ToList();
            var input = line["input"] is JsonNode text ? replay.IntoJson(text.GetValue<string>()) : "";
            output = CliRunner.Run(args, input);
        }
        else
        {
            throw new InvalidDataException($"unknown trace line {kind}");
        }
        return expected["stdout"]!.GetValue<string>() != replay.OutOf(output.Stdout) || expected["status"]!.GetValue<int>() != output.Status
            ? $"request {index} ({kind}): the answer differs from TypeScript's: expected {Snip(expected["stdout"]!.GetValue<string>())} {expected["status"]}, got {Snip(replay.OutOf(output.Stdout))} {output.Status}"
            : null;
    }

    // The world a request touches: the first folder after {TMP} in its recorded text.
    private static string WorldOf(JsonObject line) =>
        Regex.Match(line.ToJsonString(), @"\{TMP\}[\\/]+([^\\/""]+)") is { Success: true } match
            ? match.Groups[1].Value
            : throw new InvalidDataException($"a request names no world: {Snip(line.ToJsonString())}");

    private static string Snip(string text) => text.Length > 240 ? text[..240] + "..." : text;

    // The files of a world made here, against TypeScript's: the same names, each with the same hash. A world TypeScript did not make
    // (`__missing__`) must not exist here either.
    private static string? CompareWorld(string dir, JsonObject expected)
    {
        if (expected.ContainsKey("__missing__"))
        {
            return Directory.Exists(dir) ? "a world exists where TypeScript made none" : null;
        }
        if (!Directory.Exists(dir))
        {
            return "no world was made";
        }
        var actual = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories)
            .Select(path => (Name: Path.GetRelativePath(dir, path).Replace(Path.DirectorySeparatorChar, '/'), Hash: Hash(path)))
            .ToDictionary(file => file.Name, file => file.Hash, StringComparer.Ordinal);
        var names = expected.Select(pair => pair.Key).Order(StringComparer.Ordinal).ToList();
        if (!names.SequenceEqual(actual.Keys.Order(StringComparer.Ordinal)))
        {
            return "the files differ in name";
        }
        foreach (var name in names)
        {
            if (expected[name]!.GetValue<string>() != actual[name])
            {
                return $"{name} differs from TypeScript's";
            }
        }
        return null;
    }

    private static string Hash(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();

    // The placeholders of one replay: where its scratch directory and the scenario folder are, and how a recorded text becomes them.
    private sealed class Replay(string scratch, string root)
    {
        private readonly string scenes = Path.Combine(scratch, "_scenes");

        public string Into(string text) => Native(text.Replace("{TMP}", scratch).Replace("{ROOT}", root));

        public string IntoJson(string text) => NativeJson(text.Replace("{TMP}", Escape(scratch)).Replace("{ROOT}", Escape(root)));

        // An answer back in placeholders, so the replay's own folders do not show in the comparison. TypeScript's trace was recorded on
        // Windows, so a path after a placeholder is written back with the backslashes it had there.
        public string OutOf(string text) => Recorded(text
            .Replace(Escape(scratch), "{TMP}")
            .Replace(scratch, "{TMP}")
            .Replace(Escape(root), "{ROOT}")
            .Replace(root, "{ROOT}"));

        public string Scene(int index, JsonNode scene) => Write(Path.Combine(scenes, $"{index}.json"), scene.ToJsonString());

        public string Coverage(int index, JsonNode coverage) => Write(Path.Combine(scenes, $"{index}-coverage.json"), coverage.ToJsonString());

        private static string Write(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, text);
            return path;
        }

        // The recorded paths use Windows separators. Where the replay's folders are Unix paths, the run of a path after the folder
        // (already substituted) is read with its separators as the host's: a backslash, or a doubled one inside JSON, becomes a slash.
        private string Native(string text) => Path.DirectorySeparatorChar == '\\' ? text : Regex.Replace(text, Run(scratch, root), match => match.Value.Replace('\\', '/'));

        private string NativeJson(string text) => Path.DirectorySeparatorChar == '\\' ? text : Regex.Replace(text, Run(Escape(scratch), Escape(root)), match => match.Value.Replace("\\\\", "/").Replace('\\', '/'));

        private static string Run(string first, string second) =>
            "(?:" + Regex.Escape(first) + "|" + Regex.Escape(second) + @")(?:\\\\?[\w.\-]+)*";

        private static string Recorded(string text) => Path.DirectorySeparatorChar == '\\'
            ? text
            : Regex.Replace(text, @"\{(?:TMP|ROOT)\}(?:/[\w.\-]+)*", match => match.Value.Replace("/", "\\\\"));

        // A path as it sits inside a JSON string: backslashes doubled.
        private static string Escape(string path) => path.Replace("\\", "\\\\");
    }
}
