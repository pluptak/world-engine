using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// A world whose templates.json names another set than its head, the state a crash between the stamps of an upgrade leaves, against what
// TypeScript does on opening it (Fixtures/takeover-golden.expected.json, from tools/golden-gen/takeover-golden.ts): taken over when the
// log replays under the new set to the stored files, else refused as a lost field, `templates_changed` or `invalid_templates`. Each
// case patches the resolved set in templates.json (and may damage a file), and must answer TypeScript's way to opening, `verify`, and
// `verify` again, and leave the same files.
public class TakeoverGoldenTests : IDisposable
{
    private readonly string scratch = Path.Combine(Path.GetTempPath(), "takeover-net-" + Guid.NewGuid().ToString("N"));
    private readonly JsonObject golden = (JsonObject)JsonNode.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "takeover-golden.expected.json")))!;

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
    public void Opening_a_world_under_another_set_does_what_TypeScript_does()
    {
        var pristine = MixedWorld.Build(golden, Path.Combine(scratch, "pristine"));
        StoreWorld.Open(pristine).Edit((JsonObject)golden["extra"]!["edit"]!);
        var problems = new List<string>();
        if (GoldenUpdate.Enabled)
        {
            golden["pristine"] = MixedWorld.Observe(pristine);
        }
        else
        {
            MixedWorld.Compare("pristine", MixedWorld.Observe(pristine), golden["pristine"]!, problems);
        }

        var number = 0;
        foreach (var node in (JsonArray)golden["cases"]!)
        {
            number += 1;
            var dir = Path.Combine(scratch, $"c{number}");
            MixedWorld.CopyDirectory(pristine, dir);
            var templates = Path.Combine(dir, "templates.json");
            var set = JsonNode.Parse(File.ReadAllText(templates))!;
            foreach (var patch in ((JsonArray)node!["patches"]!).Cast<JsonObject>())
            {
                Patch(set, patch);
            }
            File.WriteAllText(templates, CanonicalJson.Serialize(set));
            if (node["damage"] is JsonObject damage)
            {
                var path = Path.Combine(dir, damage["file"]!.GetValue<string>());
                if (damage["op"]!.GetValue<string>() == "delete_file")
                {
                    File.Delete(path);
                }
                else
                {
                    var bytes = File.ReadAllBytes(path);
                    File.WriteAllBytes(path, bytes[..^7]);
                }
            }
            if (GoldenUpdate.Enabled)
            {
                node["observed"] = MixedWorld.Observe(dir);
                continue;
            }
            MixedWorld.Compare(node["name"]!.GetValue<string>(), MixedWorld.Observe(dir), node["observed"]!, problems);
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("takeover-golden.expected.json", golden);
            return;
        }
        Assert.True(problems.Count == 0, $"{problems.Count} differ, first: {string.Join(" | ", problems.Take(8))}");
    }

    private static void Patch(JsonNode set, JsonObject patch)
    {
        var path = patch["path"]!.AsArray().Select(key => key!.GetValue<string>()).ToList();
        var at = set;
        foreach (var key in path.SkipLast(1))
        {
            at = at[key]!;
        }
        var last = path[^1];
        if (patch["delete"]?.GetValue<bool>() == true)
        {
            at.AsObject().Remove(last);
        }
        else
        {
            at.AsObject()[last] = patch["set"]?.DeepClone();
        }
    }
}
