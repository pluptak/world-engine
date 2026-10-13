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
        var pristine = Build();
        var problems = new List<string>();
        Compare("pristine", Observe(pristine), golden["pristine"]!, problems);

        var cases = (JsonArray)golden["cases"]!;
        var number = 0;
        foreach (var node in cases)
        {
            number += 1;
            var dir = Path.Combine(scratch, $"c{number}");
            CopyDirectory(pristine, dir);
            Tamper(dir, node!["file"]!.GetValue<string>(), (JsonObject)node["op"]!);
            Compare(node["name"]!.GetValue<string>(), Observe(dir), node["observed"]!, problems);
        }
        Assert.True(problems.Count == 0, $"{problems.Count} of {cases.Count + 1} differ, first: {string.Join(" | ", problems.Take(8))}");
    }

    // The mixed run, written through a store world.
    private string Build()
    {
        var registry = Registry();
        var made = WorldBuilder.Snapshot(golden["scene"]!, registry);
        var dir = Path.Combine(scratch, "pristine");
        WorldBuilder.Create(dir, made.Snapshot, registry, made.Ids);
        var world = StoreWorld.Open(dir);
        foreach (var step in (JsonArray)golden["steps"]!)
        {
            if (step!["edit"] is JsonObject edit)
            {
                world.Edit(edit);
            }
            else
            {
                world.Apply(WorldJson.Read<Command>(step["command"]!.ToJsonString()), step["basedOn"]?.GetValue<long>());
            }
        }
        return dir;
    }

    private static IReadOnlyDictionary<string, Template> Registry()
    {
        var declared = new Dictionary<string, TemplateDecl>(StringComparer.Ordinal);
        foreach (var folder in new[] { "templates", "tamper-templates" })
        {
            foreach (var (id, decl) in TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", folder)).Decls)
            {
                declared[id] = decl;
            }
        }
        return TemplateResolver.Resolve(declared);
    }

    // What `verify`, opening and `verify` again say about a world's files, and the hash of each file after.
    private static JsonObject Observe(string dir)
    {
        JsonNode VerifyOf()
        {
            try
            {
                var verification = WorldVerify.Verify(dir, WorldFiles.ReadTemplates(dir));
                if (verification.Ok)
                {
                    return new JsonObject { ["ok"] = true, ["entries"] = verification.Entries, ["version"] = verification.Version };
                }
                var divergence = verification.Divergence!;
                return new JsonObject
                {
                    ["ok"] = false,
                    ["divergence"] = new JsonObject { ["file"] = divergence.File, ["line"] = divergence.Line, ["code"] = divergence.Code },
                };
            }
            catch (Exception error)
            {
                return new JsonObject { ["error"] = CodeOf(error) };
            }
        }

        var first = VerifyOf();
        JsonNode opened;
        try
        {
            var snapshot = StoreWorld.Open(dir).CurrentSnapshot();
            opened = new JsonObject { ["snapshot"] = Hash(Encoding.UTF8.GetBytes(WorldJson.Write(snapshot))) };
        }
        catch (Exception error)
        {
            opened = new JsonObject { ["error"] = CodeOf(error) };
        }
        var files = new JsonObject();
        foreach (var path in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).OrderBy(path => path, StringComparer.Ordinal))
        {
            files[Path.GetRelativePath(dir, path).Replace(Path.DirectorySeparatorChar, '/')] = Hash(File.ReadAllBytes(path));
        }
        return new JsonObject { ["verify"] = first, ["open"] = opened, ["verify_after"] = VerifyOf(), ["files"] = files };
    }

    private static string CodeOf(Exception error) => error is WorldError world ? world.Code : "error";

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static void Compare(string name, JsonObject actual, JsonNode expected, List<string> problems)
    {
        foreach (var key in new[] { "verify", "open", "verify_after", "files" })
        {
            // The snapshot hash is of TypeScript's canonical snapshot text, which is what WorldJson.Write also produces.
            if (CanonicalJson.Serialize(actual[key]) != CanonicalJson.Serialize(expected[key]))
            {
                problems.Add($"{name}: {key} is {Snip(actual[key]!.ToJsonString())}, TypeScript's {Snip(expected[key]!.ToJsonString())}");
                return;
            }
        }
    }

    private static string Snip(string text) => text.Length > 160 ? text[..160] + "..." : text;

    private static void CopyDirectory(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var path in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(to, Path.GetRelativePath(from, path));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(path, target);
        }
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
