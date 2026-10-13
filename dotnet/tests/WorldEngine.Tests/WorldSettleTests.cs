using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// The repair `load` makes when a world's files disagree (src/store/file-store.ts `settle`), against the TypeScript store: the store-write
// world is disturbed the way a crash or a lost file would (Fixtures/settle.cases.json), opened, and every file it ends with must be the
// one the TypeScript store left (Fixtures/settle/<case>, from scratchpad/gen/settle-golden.mjs).
public class WorldSettleTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");
    private static readonly JsonArray Cases = (JsonArray)JsonNode.Parse(
        File.ReadAllText(Path.Combine(Fixtures, "settle.cases.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storesettle-" + Guid.NewGuid().ToString("N"));

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

    public static IEnumerable<object[]> CaseNames() =>
        Cases.Select(item => new object[] { item!["name"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Opening_a_disturbed_world_leaves_the_files_the_TypeScript_store_left(string name)
    {
        var dir = Path.Combine(scratch, name);
        CopyTree(Golden, dir);
        var item = Cases.Single(candidate => candidate!["name"]!.GetValue<string>() == name)!;
        foreach (var edit in item["edits"]!.AsArray())
        {
            Apply(dir, edit!);
        }

        WorldSettle.Load(dir, WorldFiles.ReadTemplates(dir));

        var expected = Path.Combine(Fixtures, "settle", name);
        Assert.Equal(Files(expected), Files(dir));
        foreach (var relative in Files(expected))
        {
            Assert.True(
                File.ReadAllBytes(Path.Combine(expected, relative)).AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(dir, relative))),
                $"{relative} differs from the TypeScript store's");
        }
    }

    [Fact]
    public void Reading_history_from_a_disturbed_world_settles_it_first()
    {
        var whole = Path.Combine(scratch, "whole");
        var lost = Path.Combine(scratch, "lost");
        CopyTree(Golden, whole);
        CopyTree(Golden, lost);
        File.AppendAllText(Path.Combine(lost, "events.jsonl"), "x");

        var expected = WorldHistory.Since(whole, 0, WorldFiles.ReadTemplates(whole));
        var settled = WorldHistory.Since(lost, 0, WorldFiles.ReadTemplates(lost));

        Assert.Equal(WorldJson.Write(expected.Events), WorldJson.Write(settled.Events));
        Assert.Equal(WorldJson.Write(expected.Deltas), WorldJson.Write(settled.Deltas));
        // The head now agrees with the files, so the world is trusted as it stands.
        Assert.NotNull(WorldReplay.TrustedSnapshot(lost, WorldFiles.ReadTemplates(lost)));
    }

    // One disturbance: copy a file over another, delete one, append text, or set fields of head.json.
    private static void Apply(string dir, JsonNode edit)
    {
        var path = Path.Combine(dir, edit["file"]!.GetValue<string>());
        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        switch (edit["op"]!.GetValue<string>())
        {
            case "copy":
                File.Copy(Path.Combine(dir, edit["from"]!.GetValue<string>()), path, overwrite: true);
                break;
            case "delete":
                File.Delete(path);
                break;
            case "append":
                File.AppendAllText(path, edit["text"]!.GetValue<string>(), utf8);
                break;
            case "head_set":
                var head = (JsonObject)JsonNode.Parse(File.ReadAllText(path))!;
                foreach (var (key, value) in edit["fields"]!.AsObject())
                {
                    head[key] = value?.DeepClone();
                }
                File.WriteAllText(path, head.ToJsonString(), utf8);
                break;
            default:
                throw new InvalidOperationException($"Unknown edit {edit["op"]}");
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
