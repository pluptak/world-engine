using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The mixed run of tests/verify.test.ts and what is observed of a stored world (tools/golden-gen/mixed-world.ts), shared by the goldens
// that damage a stored world or change its template set.
internal static class MixedWorld
{
    // The mixed run, written through a store world.
    public static string Build(JsonObject golden, string dir)
    {
        var registry = Registry();
        var made = WorldBuilder.Snapshot(golden["scene"]!, registry);
        WorldBuilder.Create(dir, made.Snapshot, registry, made.Ids);
        var world = StoreWorld.Open(dir);
        foreach (var step in (JsonArray)golden["steps"]!)
        {
            if (step!["edit"] is JsonObject edit)
            {
                world.Edit(Edits.Of(edit));
            }
            else
            {
                world.Apply(WorldJson.Read<Command>(step["command"]!.ToJsonString()), step["basedOn"]?.GetValue<long>());
            }
        }
        return dir;
    }

    public static IReadOnlyDictionary<string, Template> Registry()
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
    public static JsonObject Observe(string dir)
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
            opened = new JsonObject { ["snapshot"] = Meaning.Digest(WorldJson.Write(snapshot)) };
        }
        catch (Exception error)
        {
            opened = new JsonObject { ["error"] = CodeOf(error) };
        }
        var files = new JsonObject();
        foreach (var path in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).OrderBy(path => path, StringComparer.Ordinal))
        {
            files[Path.GetRelativePath(dir, path).Replace(Path.DirectorySeparatorChar, '/')] = Meaning.FileDigest(path);
        }
        return new JsonObject { ["verify"] = first, ["open"] = opened, ["verify_after"] = VerifyOf(), ["files"] = files };
    }

    public static string CodeOf(Exception error) => error is WorldError world ? WorldJson.Name(world.Code) : "error";

    public static void CopyDirectory(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var path in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(to, Path.GetRelativePath(from, path));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(path, target);
        }
    }


    public static void Compare(string name, JsonObject actual, JsonNode expected, List<string> problems)
    {
        foreach (var key in new[] { "verify", "open", "verify_after", "files" })
        {
            // The snapshot hash is of TypeScript's canonical snapshot text, which is what WorldJson.Write also produces.
            if (!Meaning.Matches(expected[key], actual[key]))
            {
                problems.Add($"{name}: {key} is {Snip(actual[key]!.ToJsonString())}, TypeScript's {Snip(expected[key]!.ToJsonString())}");
                return;
            }
        }
    }

    private static string Snip(string text) => text.Length > 160 ? text[..160] + "..." : text;

}
