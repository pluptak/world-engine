using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Store;

namespace WorldEngine.Tests;

// Verification (src/store/file-store.ts `verify`) against the TypeScript verifier: the store-write world as it stands, and five copies
// each corrupted in one file (Fixtures/verify-golden.expected.json, from scratchpad/gen/verify-golden.mjs). Every answer, including the
// file, line and code of each divergence, must be the one the TypeScript verifier gave.
public class WorldVerifyTests : IDisposable
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly string Golden = Path.Combine(Fixtures, "store-write");
    private static readonly JsonObject Document = (JsonObject)JsonNode.Parse(
        File.ReadAllText(Path.Combine(Fixtures, "verify-golden.expected.json")))!;

    private readonly string scratch = Path.Combine(Path.GetTempPath(), "storeverify-" + Guid.NewGuid().ToString("N"));

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

    public static IEnumerable<object[]> Cases() =>
        Document["cases"]!.AsArray().Select(item => new object[] { item!["name"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(Cases))]
    public void Verify_answers_what_the_TypeScript_verifier_answered(string name)
    {
        var dir = Path.Combine(scratch, name);
        CopyTree(Golden, dir);
        var item = Document["cases"]!.AsArray().Single(candidate => candidate!["name"]!.GetValue<string>() == name)!;
        Corrupt(dir, item);

        var answer = WorldVerify.Verify(dir, WorldFiles.ReadTemplates(dir));
        var expected = Document["expected"]![name]!;

        if (expected["ok"]!.GetValue<bool>())
        {
            Assert.True(answer.Ok);
            Assert.Equal(expected["entries"]!.GetValue<int>(), answer.Entries);
            Assert.Equal(expected["version"]!.GetValue<long>(), answer.Version);
        }
        else
        {
            Assert.NotNull(answer.Divergence);
            Assert.Equal(expected["divergence"]!["file"]!.GetValue<string>(), answer.Divergence!.File);
            Assert.Equal(expected["divergence"]!["line"]!.GetValue<int>(), answer.Divergence.Line);
            Assert.Equal(expected["divergence"]!["code"]!.GetValue<string>(), answer.Divergence.Code);
        }
    }

    // The corruption the golden generator made, applied the same way: drop the last line, replace one string, or append a space.
    private static void Corrupt(string dir, JsonNode item)
    {
        if (item["file"] is null)
        {
            return;
        }
        var path = Path.Combine(dir, item["file"]!.GetValue<string>().Replace('/', Path.DirectorySeparatorChar));
        var text = File.ReadAllText(path, Encoding.UTF8);
        var changed = item["op"]!.GetValue<string>() switch
        {
            "drop_last_line" => text[..(text.LastIndexOf('\n', text.Length - 2) + 1)],
            "replace" => text.Replace(item["from"]!.GetValue<string>(), item["to"]!.GetValue<string>(), StringComparison.Ordinal),
            _ => text + item["text"]!.GetValue<string>(),
        };
        File.WriteAllText(path, changed, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
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
