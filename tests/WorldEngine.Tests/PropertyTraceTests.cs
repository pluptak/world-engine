using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
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
        var initial = Initial();
        // The seeds are independent worlds, so they replay in parallel; failures are reported in seed order.
        var records = Records().ToList();
        var failed = new string?[records.Count];
        Parallel.For(0, records.Count, index =>
        {
            if (!Depth.Takes(index, 5))
            {
                return;
            }
            var failures = new List<string>();
            Replay(new MemoryWorld(initial, registry, initial.TemplatesHash), records[index], failures);
            failed[index] = failures.FirstOrDefault();
        });
        var seeds = records.Count;
        var failures = failed.OfType<string>().ToList();
        if (GoldenUpdate.Enabled)
        {
            WriteTrace(records);
            return;
        }
        Assert.True(seeds >= 500, $"only {seeds} seeds were recorded");
        Assert.True(failures.Count == 0, $"{failures.Count} of {seeds} sequences diverge, first: {string.Join("; ", failures.Take(5))}");
    }

    // The same sequences against a store world, whose files must stay the replay of its log: the answers and snapshots are the memory
    // world's (as in tests/property-run.ts `storeSubsetTest`), `verify` is clean, and a fresh open reads back the snapshot it left. Twenty
    // seeds, where TypeScript ran sixty: the memory replay above covers every seed, and Block 21 and the tamper goldens cover the store.
    [Fact]
    public void The_first_sequences_on_a_store_world_give_the_same_answers_and_verify()
    {
        var registry = Registry();
        var initial = Initial();
        var scratch = Path.Combine(Path.GetTempPath(), "property-store-" + Guid.NewGuid().ToString("N"));
        try
        {
            var records = Records().Take(Depth.Count(deep: 20, sampled: 5)).ToList();
            var failed = new List<string>[records.Count];
            Parallel.For(0, records.Count, index =>
            {
                var record = records[index];
                var failures = failed[index] = [];
                var dir = Path.Combine(scratch, $"seed-{record["seed"]}");
                WorldBuilder.Create(dir, initial, registry, new Dictionary<string, string>());
                var world = StoreWorld.Open(dir);
                Replay(world, record, failures);
                var verdict = world.Verify();
                if (!verdict.Ok)
                {
                    failures.Add($"seed {record["seed"]}: verify names {verdict.Divergence}");
                }
                var reopened = StoreWorld.Open(dir).CurrentSnapshot();
                if (WorldJson.Write(reopened) != WorldJson.Write(world.CurrentSnapshot()))
                {
                    failures.Add($"seed {record["seed"]}: a fresh open reads another snapshot");
                }
            });
            var failures = failed.SelectMany(list => list).ToList();
            Assert.True(failures.Count == 0, $"{failures.Count} problems, first: {string.Join("; ", failures.Take(5))}");
        }
        finally
        {
            try
            {
                Directory.Delete(scratch, recursive: true);
            }
            catch (IOException)
            {
                // A file a failed run left open is the run's own leftover.
            }
        }
    }

    // One recorded sequence against a world: the first step whose answer or snapshot differs is the only one reported.
    private static void Replay(IWorld world, JsonObject record, List<string> failures)
    {
        var seed = record["seed"]!.GetValue<int>();
        var steps = record["steps"]!.AsArray();
        for (var index = 0; index < steps.Count; index++)
        {
            var recorded = steps[index]!;
            var step = recorded["step"]!;
            var result = step["edit"] is JsonObject edit
                ? world.Edit(edit)
                : world.Apply(WorldJson.Read<Command>(step.ToJsonString()));
            if (GoldenUpdate.Enabled)
            {
                recorded["result"] = Hash(MemoryGoldenTests.Shape(result));
                recorded["snapshot"] = SnapshotHash(world);
                continue;
            }
            if (Hash(MemoryGoldenTests.Shape(result)) != recorded["result"]!.GetValue<string>())
            {
                failures.Add($"seed {seed} step {index}: the answer differs ({step.ToJsonString()})");
                return;
            }
            if (SnapshotHash(world) != recorded["snapshot"]!.GetValue<string>())
            {
                failures.Add($"seed {seed} step {index}: the snapshot differs ({step.ToJsonString()})");
                return;
            }
        }
    }

    // The recorded sequences, one line each, gzipped (the layout tools/golden-gen/property-trace.ts writes).
    private static void WriteTrace(List<JsonObject> records)
    {
        using var file = File.Create(GoldenUpdate.SourcePath(Path.Combine("property", "trace.jsonl.gz")));
        using var zip = new GZipStream(file, CompressionLevel.SmallestSize);
        zip.Write(Encoding.UTF8.GetBytes(string.Join("\n", records.Select(record => record.ToJsonString())) + "\n"));
    }

    private static Snapshot Initial() => WorldJson.Read<Snapshot>(File.ReadAllText(Path.Combine(Folder, "initial.snapshot.json")));

    private static IEnumerable<JsonObject> Records() => Lines().Select(line => (JsonObject)JsonNode.Parse(line)!);

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

    private static string Hash(JsonNode? value) => Meaning.Digest(value?.ToJsonString() ?? "null");

    // The snapshot by meaning, so its encoding does not count.
    private static string SnapshotHash(IWorld world) => Meaning.Digest(WorldJson.Write(world.CurrentSnapshot()));

}
