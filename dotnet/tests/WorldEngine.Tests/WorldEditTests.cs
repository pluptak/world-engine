using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The store's edit (src/api.ts `edit`) against the TypeScript store: two set_seed edits on a copy of the store-write world, one with the
// default id (edit-7, one more than the logged submissions) and one with an explicit id. Every file must be the TypeScript store's
// (Fixtures/store-edit, from scratchpad/gen/edit-store-golden.mjs).
public class WorldEditTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-edit");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storeedit-" + Guid.NewGuid().ToString("N"));

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
    public void Edits_take_default_and_explicit_ids_and_the_files_match_the_TypeScript_store()
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Path.Combine(Fixtures, "store-write"), dir);
        var registry = WorldFiles.ReadTemplates(dir);
        var edits = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "store-edit.edits.json")))!;

        var ids = new List<string>();
        foreach (var item in edits)
        {
            var explicitId = item!["command_id"] is { } value ? value.GetValue<string>() : null;
            var result = WorldEdits.Edit(dir, registry, item["edit"]!.AsObject(), explicitId);
            ids.Add(result.CommandId);
        }

        Assert.Equal(["edit-7", "tuned"], ids);
        Assert.Equal(Files(Golden), Files(dir));
        foreach (var relative in Files(Golden))
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(Golden, relative)).AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(dir, relative))),
                $"{relative} differs from the TypeScript store's");
        }
    }

    private static List<string> Files(string root) =>
        Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)
            .ToList();

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
