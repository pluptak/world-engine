using WorldEngine.Core.Templates;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The store's template upgrade against the TypeScript store (src/api.ts `upgradeTemplates`, src/store/file-store.ts `writeWorldTemplates`,
// `settle`'s takeover). The target is the shipped set plus upgrade_probe, a copy of stone under a new id that nothing in the world uses, so
// the hash moves and no replay does. Two results must be the TypeScript store's: the world after the upgrade (Fixtures/upgrade-applied) and
// that world with head.json put back as a crash before the head's write leaves it, opened and taken over (Fixtures/upgrade-takeover). From
// scratchpad/gen/upgrade-store-golden.mjs.
public class WorldUpgradeTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storeupgrade-" + Guid.NewGuid().ToString("N"));

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

    // The shipped set and the probe, built the way the golden built it.
    private static IReadOnlyDictionary<string, Template> Target()
    {
        var target = new Dictionary<string, Template>(TestTemplates.RepoRegistry, StringComparer.Ordinal)
        {
            ["upgrade_probe"] = TestTemplates.RepoRegistry["stone"] with { Id = "upgrade_probe" },
        };
        return target;
    }

    [Fact]
    public void Upgrading_the_world_writes_the_files_the_TypeScript_store_wrote()
    {
        var dir = Path.Combine(scratch, "applied");
        CopyTree(Golden, dir);

        var snapshot = WorldUpgrade.UpgradeTemplates(dir, Target(), WorldFiles.ReadTemplates(dir));

        Assert.Equal(Hash(Target()), snapshot.TemplatesHash);
        AssertSameTree(Path.Combine(Fixtures, "upgrade-applied"), dir);
    }

    [Fact]
    public void Opening_an_interrupted_upgrade_takes_the_world_over_as_the_TypeScript_store_did()
    {
        var dir = Path.Combine(scratch, "takeover");
        CopyTree(Path.Combine(Fixtures, "upgrade-applied"), dir);
        // The crash: the templates and snapshot are stamped with the new set, the head still names the old one.
        File.Copy(Path.Combine(Golden, WorldFiles.Head), Path.Combine(dir, WorldFiles.Head), overwrite: true);

        var snapshot = WorldSettle.Load(dir, WorldFiles.ReadTemplates(dir), setIsTheWorlds: true);

        Assert.Equal(Hash(Target()), snapshot.TemplatesHash);
        AssertSameTree(Path.Combine(Fixtures, "upgrade-takeover"), dir);
    }

    private static string Hash(IReadOnlyDictionary<string, Template> registry) => WorldReplay.HashOf(registry);

    private static void AssertSameTree(string expected, string dir)
    {
        Assert.Equal(Files(expected), Files(dir));
        foreach (var relative in Files(expected))
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(expected, relative)).AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(dir, relative))),
                $"{relative} differs from the TypeScript store's");
        }
    }

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
