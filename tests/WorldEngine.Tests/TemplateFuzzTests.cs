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
        Directory.CreateDirectory(dir);
        var source = Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates");
        foreach (var path in Directory.EnumerateFiles(source))
        {
            File.Copy(path, Path.Combine(dir, Path.GetFileName(path)));
        }

        var differing = new List<string>();
        var cases = (JsonArray)golden["cases"]!;
        Assert.NotEmpty(cases);
        foreach (var row in cases.Cast<JsonArray>())
        {
            var template = row[0]!.GetValue<string>();
            var file = Path.Combine(dir, $"{template}.json");
            var original = File.ReadAllText(file);
            var mutated = JsonNode.Parse(original)!;
            Mutate(mutated, [.. row[1]!.AsArray().Select(key => key!.GetValue<string>())], (JsonObject)row[2]!);
            File.WriteAllText(file, mutated.ToJsonString());
            var actual = Answer();
            File.WriteAllText(file, original);
            if (GoldenUpdate.Enabled)
            {
                row[3] = actual;
                continue;
            }
            var expected = row[3]!.GetValue<string>();
            var sameVerdict = actual == expected;
            if (!sameVerdict)
            {
                differing.Add($"{template} {row[1]!.ToJsonString()} {row[2]!.ToJsonString()}: {actual} | TypeScript's {expected}");
            }
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.WriteGzip("template-fuzz.expected.json.gz", golden);
            return;
        }
        Assert.True(differing.Count == 0, $"{differing.Count} of {cases.Count} differ, first: {string.Join(" || ", differing.Take(6))}");
    }

    private string Answer()
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
