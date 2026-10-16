using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// A stored world damaged byte by byte, against TypeScript's verdicts (Fixtures/tamper-golden.expected.json, from
// tools/golden-gen/tamper-golden.ts). The mixed run of tests/verify.test.ts is built here (every kind of submission, an edit, 260 waits
// past the checkpoint), and must be the same files as TypeScript's. Each case then damages one file in one way (a line dropped, doubled
// or swapped, the file cut, emptied or gone, a byte flipped, text appended) and must give TypeScript's answer to `verify`, to opening the
// world (the snapshot it settles to, or the error code), to `verify` again, and leave the same files behind.
public class TamperGoldenTests : IDisposable
{
    private readonly string scratch = Path.Combine(Path.GetTempPath(), "tamper-net-" + Guid.NewGuid().ToString("N"));
    private readonly JsonObject golden = (JsonObject)JsonNode.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "tamper-golden.expected.json")))!;

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
    public void The_mixed_run_writes_TypeScripts_files_and_every_damage_is_judged_as_TypeScript_judges_it()
    {
        var pristine = MixedWorld.Build(golden, Path.Combine(scratch, "pristine"));
        var problems = new List<string>();
        if (GoldenUpdate.Enabled)
        {
            golden["pristine"] = MixedWorld.Observe(pristine);
        }
        else
        {
            MixedWorld.Compare("pristine", MixedWorld.Observe(pristine), golden["pristine"]!, problems);
        }

        var cases = (JsonArray)golden["cases"]!;
        Assert.NotEmpty(cases);
        // Each case damages its own copy, so they run in parallel; problems are reported in case order.
        var found = new List<string>[cases.Count];
        Parallel.For(0, cases.Count, index =>
        {
            found[index] = [];
            if (!Depth.Takes(index, 3))
            {
                return;
            }
            var node = cases[index]!;
            var dir = Path.Combine(scratch, $"c{index + 1}");
            MixedWorld.CopyDirectory(pristine, dir);
            Tamper(dir, node["file"]!.GetValue<string>(), (JsonObject)node["op"]!);
            if (GoldenUpdate.Enabled)
            {
                node["observed"] = MixedWorld.Observe(dir);
                return;
            }
            MixedWorld.Compare(node["name"]!.GetValue<string>(), MixedWorld.Observe(dir), node["observed"]!, found[index]);
        });
        problems.AddRange(found.SelectMany(list => list));
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("tamper-golden.expected.json", golden);
            return;
        }
        Assert.True(problems.Count == 0, $"{problems.Count} of {cases.Count + 1} differ, first: {string.Join(" | ", problems.Take(8))}");
    }

    // The same damage tools/golden-gen/tamper-golden.ts does, on bytes.
    private static void Tamper(string dir, string file, JsonObject op)
    {
        var path = Path.Combine(dir, file);
        var kind = op["op"]!.GetValue<string>();
        if (kind == "delete_file")
        {
            File.Delete(path);
            return;
        }
        var bytes = File.ReadAllBytes(path);
        var n = op["n"]?.GetValue<int>() ?? 0;
        List<byte[]> Lines()
        {
            var all = new List<byte[]>();
            var from = 0;
            for (var index = 0; index < bytes.Length; index++)
            {
                if (bytes[index] == 10)
                {
                    all.Add(bytes[from..(index + 1)]);
                    from = index + 1;
                }
            }
            if (from < bytes.Length)
            {
                all.Add(bytes[from..]);
            }
            return all;
        }
        switch (kind)
        {
            case "empty":
                bytes = [];
                break;
            case "delete_line":
            {
                var all = Lines();
                all.RemoveAt(n);
                bytes = [.. all.SelectMany(line => line)];
                break;
            }
            case "dup_line":
            {
                var all = Lines();
                all.Insert(n, all[n]);
                bytes = [.. all.SelectMany(line => line)];
                break;
            }
            case "swap_lines":
            {
                var all = Lines();
                (all[n], all[n + 1]) = (all[n + 1], all[n]);
                bytes = [.. all.SelectMany(line => line)];
                break;
            }
            case "truncate":
                bytes = bytes[..(n < 0 ? bytes.Length + n : n)];
                break;
            case "flip_byte":
                bytes[n < 0 ? bytes.Length + n : n] ^= 1;
                break;
            case "append":
                bytes = [.. bytes, .. Encoding.UTF8.GetBytes(op["text"]!.GetValue<string>())];
                break;
            default:
                throw new InvalidDataException(kind);
        }
        File.WriteAllBytes(path, bytes);
    }
}
