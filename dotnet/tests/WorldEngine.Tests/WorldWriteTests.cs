using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The write path (src/store/file-store.ts `submit`) against the TypeScript store: the same world as created, the same commands in the same
// order, a snapshot and a checkpoint every 2 accepted commands. Every file the TypeScript store wrote (Fixtures/store-write, from
// scratchpad/gen/store-write.mjs) must be byte-identical to what the .NET submit writes, refused and unresolved commands included.
public class WorldWriteTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Start = Path.Combine(Fixtures, "store-write-start");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storewrite-" + Guid.NewGuid().ToString("N"));

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
    public void Submitting_the_TypeScript_command_sequence_writes_the_files_it_wrote()
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Start, dir);
        var registry = WorldFiles.ReadTemplates(dir);
        var commands = WorldJson.Read<List<Command>>(File.ReadAllText(Path.Combine(Fixtures, "store-write.commands.json")));

        var statuses = commands
            .Select(command => WorldWriter.Submit(dir, registry, command, snapshotEvery: 2, checkpointEvery: 2).Status.ToString().ToLowerInvariant())
            .ToList();

        Assert.Equal(["ok", "refused", "ok", "unresolved", "ok", "ok"], statuses);
        Assert.Equal(Files(Golden), Files(dir));
        foreach (var relative in Files(Golden))
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(Golden, relative)).AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(dir, relative))),
                $"{relative} differs from the TypeScript store's");
        }
    }

    // Every file under `root`, as relative paths in ordinal order.
    private static List<string> Files(string root) =>
        Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace('\\', '/'))
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
