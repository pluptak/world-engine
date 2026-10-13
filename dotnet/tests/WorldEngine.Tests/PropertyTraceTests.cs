using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The differential soak: the TypeScript property sequences (tests/property-gen.ts, seeds 0 to 499, 30 steps each), recorded by
// tools/golden-gen/property-trace.ts as the steps TypeScript generated and a hash of each answer and of the snapshot it left
// (Fixtures/property). Each step is replayed here against a memory world, so a divergence anywhere in an engine path the generator
// reaches shows at the step it first happens, and later steps are not compared against a state that has already drifted.
public class PropertyTraceTests
{
    private static readonly string Folder = Path.Combine(AppContext.BaseDirectory, "Fixtures", "property");

    [Fact]
    public void Every_recorded_sequence_gives_TypeScripts_answers_and_snapshots()
    {
        var registry = Registry();
        var initial = WorldJson.Read<Snapshot>(File.ReadAllText(Path.Combine(Folder, "initial.snapshot.json")));
        var failures = new List<string>();
        var seeds = 0;
        foreach (var line in Lines())
        {
            var record = (JsonObject)JsonNode.Parse(line)!;
            var seed = record["seed"]!.GetValue<int>();
            seeds += 1;
            var world = new MemoryWorld(initial, registry, initial.TemplatesHash);
            var steps = record["steps"]!.AsArray();
            for (var index = 0; index < steps.Count; index++)
            {
                var recorded = steps[index]!;
                var step = recorded["step"]!;
                var result = step["edit"] is JsonObject edit
                    ? world.Edit(edit)
                    : world.Apply(WorldJson.Read<Command>(step.ToJsonString()));
                var answer = Hash(MemoryGoldenTests.Shape(result));
                var snapshot = Hash(JsonNode.Parse(WorldJson.Write(world.CurrentSnapshot())));
                if (answer != recorded["result"]!.GetValue<string>())
                {
                    failures.Add($"seed {seed} step {index}: the answer differs ({step.ToJsonString()})");
                    break;
                }
                if (snapshot != recorded["snapshot"]!.GetValue<string>())
                {
                    failures.Add($"seed {seed} step {index}: the snapshot differs ({step.ToJsonString()})");
                    break;
                }
            }
        }
        Assert.True(seeds >= 500, $"only {seeds} seeds were recorded");
        Assert.True(failures.Count == 0, $"{failures.Count} of {seeds} sequences diverge, first: {string.Join("; ", failures.Take(5))}");
    }

    private static IEnumerable<string> Lines()
    {
        using var file = File.OpenRead(Path.Combine(Folder, "trace.jsonl.gz"));
        using var zip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(zip, Encoding.UTF8);
        while (reader.ReadLine() is { } line)
        {
            if (line.Length > 0)
            {
                yield return line;
            }
        }
    }

    // The property registry: the shipped templates, with the fixture templates the properties add (and one they replace) on top.
    private static IReadOnlyDictionary<string, Template> Registry()
    {
        var declared = new Dictionary<string, TemplateDecl>(StringComparer.Ordinal);
        foreach (var folder in new[] { Path.Combine("Fixtures", "templates"), Path.Combine("Fixtures", "property", "templates") })
        {
            var set = TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, folder));
            foreach (var (id, decl) in set.Decls)
            {
                declared[id] = decl;
            }
        }
        return TemplateResolver.Resolve(declared);
    }

    private static string Hash(JsonNode? value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson.Serialize(value)))).ToLowerInvariant();
}
