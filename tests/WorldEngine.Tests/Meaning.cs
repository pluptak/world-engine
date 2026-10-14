using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;

namespace WorldEngine.Tests;

// How a golden is compared: by what it means, not by its bytes. Key order does not count, nor does a null member against an absent
// one; numbers compare by value. A difference is named by the path to the first place the two part. Bytes are the contract only
// where the engine itself is checked against itself (the same commands written twice, `verify`, the canonical writer's own tests).
internal static class Meaning
{
    public static void Same(JsonNode? expected, JsonNode? actual, string label = "the answer")
    {
        var difference = Difference(expected, actual);
        Assert.True(difference is null, $"{label}: {difference}");
    }

    // `actual` (and `expected`, as text) is JSON text: an engine's written answer, a CLI's stdout, a file's contents.
    public static void Same(JsonNode? expected, string actual, string label = "the answer") =>
        Same(expected, Parse(actual), label);

    public static void Same(string expected, string actual, string label = "the answer") =>
        Same(Parse(expected), Parse(actual), label);

    public static bool Matches(JsonNode? expected, JsonNode? actual) => Difference(expected, actual) is null;

    public static bool Matches(string expected, string actual) => Difference(expected, actual) is null;

    public static string? Difference(string expected, string actual) => Difference(Parse(expected), Parse(actual));

    // The first place two values part, as a path and the two sides there; null when they mean the same.
    public static string? Difference(JsonNode? expected, JsonNode? actual, string path = "$")
    {
        switch (expected, actual)
        {
            case (null, null):
                return null;
            case (JsonObject left, JsonObject right):
                foreach (var key in Present(left).Union(Present(right)).Order(StringComparer.Ordinal))
                {
                    if (Difference(left[key], right[key], $"{path}.{key}") is { } inner)
                    {
                        return inner;
                    }
                }
                return null;
            case (JsonArray left, JsonArray right):
                for (var index = 0; index < Math.Min(left.Count, right.Count); index += 1)
                {
                    if (Difference(left[index], right[index], $"{path}[{index}]") is { } inner)
                    {
                        return inner;
                    }
                }
                return left.Count == right.Count
                    ? null
                    : $"{path} has {right.Count} items, expected {left.Count}";
            case (JsonValue left, JsonValue right) when SameScalar(left, right):
                return null;
            default:
                return $"{path} is {Show(actual)}, expected {Show(expected)}";
        }
    }

    // Two stored worlds hold the same files meaning the same: a JSON file compared as a value, a `.jsonl` file line by line. What
    // `head.json` and a checkpoint say about other files' bytes (`*_bytes`, `*_sha256`) is not compared but checked against the
    // files in `actual`, since those bytes are the store's own contract. Any other file compares by its bytes.
    public static void SameTree(string expected, string actual, string label)
    {
        Assert.Equal(Files(expected), Files(actual));
        foreach (var relative in Files(expected))
        {
            var left = File.ReadAllText(Path.Combine(expected, relative));
            var right = File.ReadAllText(Path.Combine(actual, relative));
            string? difference;
            if (relative.EndsWith(".jsonl", StringComparison.Ordinal))
            {
                var leftLines = Lines(left);
                var rightLines = Lines(right);
                difference = leftLines.Length != rightLines.Length
                    ? $"has {rightLines.Length} lines, expected {leftLines.Length}"
                    : Enumerable.Range(0, leftLines.Length)
                        .Select(index => Difference(Parse(leftLines[index]), Parse(rightLines[index]), $"line {index + 1}"))
                        .FirstOrDefault(found => found is not null);
            }
            else if (relative.EndsWith(".json", StringComparison.Ordinal))
            {
                difference = Difference(WithoutByteFacts(Parse(left)), WithoutByteFacts(Parse(right)));
            }
            else
            {
                difference = left == right ? null : "differs";
            }
            Assert.True(difference is null, $"{label}: {relative} {difference}");
        }
        AssertByteFacts(actual, label);
    }

    // What a world's head and checkpoints say about the bytes of its other files is true of the files on disk.
    public static void AssertByteFacts(string dir, string label)
    {
        if (File.Exists(Path.Combine(dir, "head.json")) && JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "head.json"))) is JsonObject head)
        {
            foreach (var (field, file) in new[] { ("log_bytes", "log.jsonl"), ("events_bytes", "events.jsonl"), ("deltas_bytes", "deltas.jsonl") })
            {
                if (head[field] is { } bytes)
                {
                    Assert.True(bytes.GetValue<long>() == Size(dir, file), $"{label}: head.json {field} is not the size of {file}");
                }
            }
            if (head["snapshot_log_bytes"] is { } snapshotBytes)
            {
                Assert.True(snapshotBytes.GetValue<long>() <= Size(dir, "log.jsonl"), $"{label}: head.json snapshot_log_bytes is past the log");
            }
        }
        var checkpoints = Path.Combine(dir, "checkpoints");
        if (!Directory.Exists(checkpoints))
        {
            return;
        }
        foreach (var path in Directory.GetFiles(checkpoints, "*.json"))
        {
            if (JsonNode.Parse(File.ReadAllText(path)) is not JsonObject checkpoint)
            {
                continue;
            }
            var log = File.ReadAllBytes(Path.Combine(dir, "log.jsonl"));
            var logBytes = checkpoint["log_bytes"]!.GetValue<long>();
            Assert.True(logBytes <= log.Length, $"{label}: {Path.GetFileName(path)} log_bytes is past the log");
            Assert.True(
                checkpoint["log_sha256"]!.GetValue<string>() == Sha256(log.AsSpan(0, (int)logBytes)),
                $"{label}: {Path.GetFileName(path)} log_sha256 is not the hash of the log's first log_bytes");
            Assert.True(
                checkpoint["initial_sha256"]!.GetValue<string>() == Sha256(File.ReadAllBytes(Path.Combine(dir, "initial.json"))),
                $"{label}: {Path.GetFileName(path)} initial_sha256 is not the hash of initial.json");
        }
    }

    private static JsonNode? WithoutByteFacts(JsonNode? node)
    {
        if (node is not JsonObject record)
        {
            return node;
        }
        var copy = (JsonObject)record.DeepClone();
        foreach (var key in copy.Select(pair => pair.Key).Where(key => key.EndsWith("_bytes", StringComparison.Ordinal) || key.EndsWith("_sha256", StringComparison.Ordinal)).ToList())
        {
            copy.Remove(key);
        }
        return copy;
    }

    private static string[] Lines(string text) => text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

    private static long Size(string dir, string file) =>
        File.Exists(Path.Combine(dir, file)) ? new FileInfo(Path.Combine(dir, file)).Length : 0;

    private static string Sha256(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static List<string> Files(string root) =>
        [.. Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)];

    // The canonical text of a value with its null members left out: what a golden that keeps only a hash hashes.
    public static string Normal(JsonNode? node) => CanonicalJson.Serialize(WithoutNulls(node));

    public static string Normal(string json) => Normal(Parse(json));

    // A hash of the normal form, for goldens too large to keep whole.
    public static string Digest(string json, int length = 64) => Sha256(Encoding.UTF8.GetBytes(Normal(json)))[..length];

    // A stored file's hash by meaning: a JSON file's normal form without its byte facts, a `.jsonl` file's lines each in normal form.
    // A file that does not read as JSON (a damaged one) is hashed by its bytes.
    public static string FileDigest(string path)
    {
        try
        {
            var text = File.ReadAllText(path);
            if (path.EndsWith(".jsonl", StringComparison.Ordinal))
            {
                return Sha256(Encoding.UTF8.GetBytes(string.Join('\n', Lines(text).Select(line => Normal(JsonNode.Parse(line))))));
            }
            if (path.EndsWith(".json", StringComparison.Ordinal))
            {
                return Sha256(Encoding.UTF8.GetBytes(Normal(WithoutByteFacts(JsonNode.Parse(text)))));
            }
        }
        catch (Exception error) when (error is JsonException or FormatException)
        {
        }
        return Sha256(File.ReadAllBytes(path));
    }

    private static IEnumerable<string> Present(JsonObject record) =>
        record.Where(pair => pair.Value is not null).Select(pair => pair.Key);

    private static bool SameScalar(JsonValue left, JsonValue right)
    {
        var kind = left.GetValueKind();
        if (kind != right.GetValueKind())
        {
            return false;
        }
        return kind switch
        {
            JsonValueKind.String => left.GetValue<string>() == right.GetValue<string>(),
            JsonValueKind.Number => NumberOf(left) == NumberOf(right),
            _ => true,
        };
    }

    private static decimal NumberOf(JsonValue value) =>
        decimal.Parse(value.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);

    private static JsonNode? WithoutNulls(JsonNode? node) => node switch
    {
        JsonObject record => new JsonObject(record
            .Where(pair => pair.Value is not null)
            .Select(pair => KeyValuePair.Create(pair.Key, WithoutNulls(pair.Value)))),
        JsonArray list => new JsonArray([.. list.Select(WithoutNulls)]),
        _ => node?.DeepClone(),
    };

    // Text that is not JSON (an empty stdout, a message) compares as itself.
    private static JsonNode? Parse(string json)
    {
        try
        {
            return JsonNode.Parse(json);
        }
        catch (JsonException)
        {
            return JsonValue.Create(json);
        }
    }

    private static string Show(JsonNode? node)
    {
        var text = node is null ? "absent" : node.ToJsonString();
        return text.Length > 160 ? text[..160] + "…" : text;
    }
}
