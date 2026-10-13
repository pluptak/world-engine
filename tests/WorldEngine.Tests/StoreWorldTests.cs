using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The facade over a stored world (src/api.ts) against the TypeScript World: the commands of Fixtures/store-write.commands.json through
// `Command` must write the store-write fixture, and the two edits of store-edit.edits.json through `Edit` must write store-edit, every file
// byte-identical. Both fixtures were written by the TypeScript World's own calls (scratchpad/gen).
public class StoreWorldTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storeworld-" + Guid.NewGuid().ToString("N"));

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
    public void Commands_through_the_facade_write_what_the_TypeScript_World_wrote()
    {
        var dir = Path.Combine(scratch, "commands");
        CopyTree(Path.Combine(Fixtures, "store-write-start"), dir);
        var world = StoreWorld.Open(dir, snapshotEvery: 2, checkpointEvery: 2);
        var commands = WorldJson.Read<List<Command>>(File.ReadAllText(Path.Combine(Fixtures, "store-write.commands.json")));

        var statuses = commands.Select(command => world.Apply(command).Status).ToList();

        Assert.Equal(["ok", "refused", "ok", "unresolved", "ok", "ok"], statuses.Select(status => status.ToString().ToLowerInvariant()));
        AssertSameTree(Path.Combine(Fixtures, "store-write"), dir);
    }

    [Fact]
    public void Edits_through_the_facade_write_what_the_TypeScript_World_wrote()
    {
        var dir = Path.Combine(scratch, "edits");
        CopyTree(Path.Combine(Fixtures, "store-write"), dir);
        var world = StoreWorld.Open(dir);
        var edits = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "store-edit.edits.json")))!;

        var ids = edits
            .Select(item => world.Edit(item!["edit"]!.AsObject(), item["command_id"]?.GetValue<string>()).CommandId)
            .ToList();

        Assert.Equal(["edit-7", "tuned"], ids);
        AssertSameTree(Path.Combine(Fixtures, "store-edit"), dir);
    }

    [Fact]
    public void The_facade_answers_the_stored_world_as_the_TypeScript_World_does()
    {
        var dir = Path.Combine(scratch, "answers");
        CopyTree(Path.Combine(Fixtures, "store-write"), dir);
        var world = StoreWorld.Open(dir);

        Assert.Equal(4, world.CurrentSnapshot().Version);
        Assert.Equal("e2", world.Id("ann"));
        Assert.Null(world.Id("nobody"));
        Assert.True(world.Verify().Ok);
        Assert.Equal(6, world.Attempts(0).Count);
        Assert.Equal(["ok", "refused", "ok", "unresolved", "ok", "ok"], world.Attempts(0).Select(attempt => attempt.Status.ToString().ToLowerInvariant()));
    }

    private static void AssertSameTree(string expected, string dir)
    {
        Assert.Equal(Files(expected), Files(dir));
        foreach (var relative in Files(expected))
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(expected, relative)).AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(dir, relative))),
                $"{relative} differs from the TypeScript World's");
        }
    }

    private static List<string> Files(string root) =>
        [.. Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
            .Order(StringComparer.Ordinal)];

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
