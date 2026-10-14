using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// Stale commands (src/store/file-store.ts `resolveSubmission` through `submit`): a command sent with an older base version is decided
// again at that version and is `preempted` when it would have succeeded there. Each command of Fixtures/store-stale.commands.json is
// submitted to the starting world (Fixtures/store-write-start) with the base it was sent with; the statuses and every file the store
// writes must be the TypeScript store's (Fixtures/store-stale, from scratchpad/gen/stale-golden.mjs).
public class WorldStaleTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Start = Path.Combine(Fixtures, "store-write-start");
    private static readonly string Golden = Path.Combine(Fixtures, "store-stale");

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storestale-" + Guid.NewGuid().ToString("N"));

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
    public void Stale_commands_are_judged_at_their_base_and_the_files_match_the_TypeScript_store()
    {
        var dir = Path.Combine(scratch, "world");
        CopyTree(Start, dir);
        var registry = WorldFiles.ReadTemplates(dir);
        var sequence = (JsonArray)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "store-stale.commands.json")))!;

        var statuses = new List<string>();
        foreach (var item in sequence)
        {
            var command = WorldJson.Read<Command>(item!["command"]!.ToJsonString());
            var basedOn = item["based_on"] is { } value ? value.GetValue<long>() : (long?)null;
            var result = WorldWriter.Submit(dir, registry, command, basedOn, snapshotEvery: 2, checkpointEvery: 2);
            statuses.Add(result.Status.ToString().ToLowerInvariant() + (result.ReasonCode is { } code ? ":" + WorldJson.Name(code) : ""));
        }

        Assert.Equal(
            ["ok", "preempted:already_held", "refused:already_held", "ok", "ok", "invalid:future_version", "invalid:invalid_version"],
            statuses);
        Assert.Equal(Files(Golden), Files(dir));
        foreach (var relative in Files(Golden))
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(Golden, relative)).AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(dir, relative))),
                $"{relative} differs from the TypeScript store's");
        }
    }

    private static List<string> Files(string root) =>
        [.. Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(root, path).Replace('\\', '/'))
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
