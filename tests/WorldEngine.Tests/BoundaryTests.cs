namespace WorldEngine.Tests;

// JSON is one encoding of the engine's values, and only the codec (`Core/Json`) knows it: the engine, the contract, the store and the
// command line read and write `Value` and records, so another encoding is one class beside `Json/` and nothing past it changes.
public class BoundaryTests
{
    [Fact]
    public void Only_the_codec_uses_System_Text_Json()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(root.FullName, "WorldEngine.slnx")))
        {
            root = root.Parent!;
        }
        var src = Path.Combine(root.FullName, "src");
        var codec = Path.Combine(src, "WorldEngine.Core", "Json") + Path.DirectorySeparatorChar;
        var found = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(path => !path.StartsWith(codec, StringComparison.Ordinal)
                && !path.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                && !path.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .Where(path => File.ReadAllText(path).Contains("System.Text.Json", StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(src, path))
            .Order(StringComparer.Ordinal)
            .ToList();

        Assert.True(found.Count == 0, $"System.Text.Json outside the codec: {string.Join(", ", found)}");
    }
}
