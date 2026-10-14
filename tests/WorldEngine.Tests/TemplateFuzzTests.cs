using System.IO.Compression;
using System.Text.Json.Nodes;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Template validation by mutation against TypeScript (Fixtures/template-fuzz.expected.json.gz, from tools/golden-gen/template-fuzz.ts):
// twelve shipped templates, every key to depth three set to thirteen odd values and deleted in turn, about 2,500 sets. Each is read as the
// directory reader reads its files, from the texts in memory with the mutated one swapped in; the answer is "ok" with the hash of the
// resolved set, or the error message, and must be TypeScript's, word for word.
public class TemplateFuzzTests
{
    [Fact]
    public void Every_mutated_set_is_accepted_or_refused_as_TypeScript_does()
    {
        JsonObject golden;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Fixtures", "template-fuzz.expected.json.gz")))
        using (var zip = new GZipStream(file, CompressionMode.Decompress))
        {
            golden = (JsonObject)JsonNode.Parse(zip)!;
        }
        var source = Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates");
        var originals = Directory.GetFiles(source, "*.json").ToDictionary(path => Path.GetFileName(path), File.ReadAllText, StringComparer.Ordinal);
        var cases = (JsonArray)golden["cases"]!;
        Assert.NotEmpty(cases);
        var rows = cases.Cast<JsonArray>().ToList();

        // The cases are independent, so they run in parallel; differences are reported in case order.
        var answers = new string?[rows.Count];
        Parallel.For(0, rows.Count, index =>
        {
            if (!Depth.Takes(index, 4))
            {
                return;
            }
            var row = rows[index];
            var file = $"{row[0]!.GetValue<string>()}.json";
            var mutated = JsonNode.Parse(originals[file])!;
            Mutate(mutated, [.. row[1]!.AsArray().Select(key => key!.GetValue<string>())], (JsonObject)row[2]!);
            var texts = originals.Select(pair => (pair.Key, pair.Key == file ? mutated.ToJsonString() : pair.Value));
            answers[index] = Answer(texts);
        });

        var differing = new List<string>();
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var actual = answers[index];
            if (actual is null)
            {
                continue;
            }
            if (GoldenUpdate.Enabled)
            {
                row[3] = actual;
                continue;
            }
            var expected = row[3]!.GetValue<string>();
            if (actual != expected)
            {
                differing.Add($"{row[0]} {row[1]!.ToJsonString()} {row[2]!.ToJsonString()}: {actual} | TypeScript's {expected}");
            }
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.WriteGzip("template-fuzz.expected.json.gz", golden);
            return;
        }
        Assert.True(differing.Count == 0, $"{differing.Count} of {cases.Count} differ, first: {string.Join(" || ", differing.Take(6))}");
    }

    private static string Answer(IEnumerable<(string File, string Text)> texts)
    {
        try
        {
            var registry = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(texts));
            return $"ok {WorldReplay.HashOf(registry)[..12]}";
        }
        catch (Exception error)
        {
            return error.Message;
        }
    }

    private static void Mutate(JsonNode root, List<string> path, JsonObject how)
    {
        var at = root;
        foreach (var key in path.SkipLast(1))
        {
            at = at is JsonArray list ? list[int.Parse(key)]! : at[key]!;
        }
        var last = path[^1];
        if (how["delete"] is not null)
        {
            if (at is JsonArray array)
            {
                array.RemoveAt(int.Parse(last));
            }
            else
            {
                at.AsObject().Remove(last);
            }
        }
        else if (at is JsonArray array)
        {
            array[int.Parse(last)] = how["set"]?.DeepClone();
        }
        else
        {
            at.AsObject()[last] = how["set"]?.DeepClone();
        }
    }
}
