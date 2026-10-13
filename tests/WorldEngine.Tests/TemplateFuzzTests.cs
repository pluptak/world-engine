using System.IO.Compression;
using System.Text.Json.Nodes;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Template validation by mutation against TypeScript (Fixtures/template-fuzz.expected.json.gz, from tools/golden-gen/template-fuzz.ts):
// twelve shipped templates, every key to depth three set to thirteen odd values and deleted in turn, about 2,500 sets. Each is written to a
// directory and loaded; the answer is "ok" with the hash of the resolved set, or the error message, and must be TypeScript's, word for word.
public class TemplateFuzzTests : IDisposable
{
    private readonly string dir = Path.Combine(Path.GetTempPath(), "fuzz-net-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try
        {
            Directory.Delete(dir, recursive: true);
        }
        catch (IOException)
        {
            // A file a failed run left open is the run's own leftover.
        }
    }

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
        var cases = (JsonArray)golden["cases"]!;
        Assert.NotEmpty(cases);
        var rows = cases.Cast<JsonArray>().ToList();

        // The cases are independent, so they run in parallel, each worker on its own copy of the set; differences are reported in case order.
        var answers = new string[rows.Count];
        var workers = 0;
        Parallel.For(0, rows.Count, () =>
        {
            var copy = Path.Combine(dir, $"w{Interlocked.Increment(ref workers)}");
            Directory.CreateDirectory(copy);
            foreach (var path in Directory.EnumerateFiles(source))
            {
                File.Copy(path, Path.Combine(copy, Path.GetFileName(path)));
            }
            return copy;
        }, (index, _, copy) =>
        {
            var row = rows[index];
            var file = Path.Combine(copy, $"{row[0]!.GetValue<string>()}.json");
            var original = File.ReadAllText(file);
            var mutated = JsonNode.Parse(original)!;
            Mutate(mutated, [.. row[1]!.AsArray().Select(key => key!.GetValue<string>())], (JsonObject)row[2]!);
            File.WriteAllText(file, mutated.ToJsonString());
            answers[index] = Answer(copy);
            File.WriteAllText(file, original);
            return copy;
        }, _ => { });

        var differing = new List<string>();
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var actual = answers[index];
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

    private static string Answer(string dir)
    {
        try
        {
            var registry = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(dir));
            return $"ok {WorldReplay.HashOf(registry)[..12]}";
        }
        catch (Exception error)
        {
            return error.Message.Replace(dir, "<dir>");
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
