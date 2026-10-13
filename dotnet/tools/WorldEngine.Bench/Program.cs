using System.Diagnostics;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store;
using WorldEngine.Store.Templates;

// The default workload of scripts/bench.ts: 10,000 alternating take/drop commands on a four-entity stored world, all ok. Prints
// one JSON line. Run from anywhere: `dotnet run -c Release --project dotnet/tools/WorldEngine.Bench`. TypeScript's numbers on the
// same workload (2026-10-13, this machine): 311 cmd/s, 3.57 ms/cmd for the first 1k and 3.17 for the last.
var root = AppContext.BaseDirectory;
while (root is not null && !Directory.Exists(Path.Combine(root, "templates")))
{
    root = Path.GetDirectoryName(root);
}
if (root is null)
{
    Console.Error.WriteLine("no templates/ folder above the executable");
    return 2;
}

var registry = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(root, "templates")));
var scenario = JsonNode.Parse("""
    [
      { "template": "room", "overrides": { "name": "room", "props": { "lit": true } } },
      { "template": "table", "overrides": { "name": "table", "location": "e1", "support": "e1", "pos": { "x": 30, "y": 0 } } },
      { "template": "bottle", "overrides": { "name": "bottle", "location": "e1", "support": "e2" } },
      { "template": "human", "overrides": { "name": "actor", "location": "e1", "support": "e1", "pos": { "x": -50, "y": 0 } } }
    ]
    """)!;

var dir = Path.Combine(Path.GetTempPath(), "world-engine-bench-" + Guid.NewGuid().ToString("N"));
try
{
    var made = WorldBuilder.Snapshot(scenario, registry);
    WorldBuilder.Create(dir, made.Snapshot, registry, made.Ids);
    var world = StoreWorld.Open(dir);
    const int commands = 10000;
    var times = new double[commands];
    var total = Stopwatch.StartNew();
    for (var i = 0; i < commands; i++)
    {
        var verb = i % 2 == 0 ? "take" : "drop";
        var command = new Command($"{verb}-{i}", "e4", verb, "bottle");
        var started = Stopwatch.GetTimestamp();
        var result = world.Apply(command);
        times[i] = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        if (result.Status != Status.Ok)
        {
            Console.WriteLine($"{{\"commands\":{commands},\"failed_at\":{i},\"status\":\"{result.Status}\"}}");
            return 1;
        }
    }
    var ms = total.Elapsed.TotalMilliseconds;
    string Avg(IEnumerable<double> part) => Math.Round(part.Average(), 2).ToString(System.Globalization.CultureInfo.InvariantCulture);
    Console.WriteLine(
        $"{{\"commands\":{commands},\"ms\":{(long)ms},\"cmd_per_s\":{(long)(commands * 1000 / Math.Max(ms, 1))},"
        + $"\"first_1k_ms_per_cmd\":{Avg(times.Take(1000))},\"last_1k_ms_per_cmd\":{Avg(times.TakeLast(1000))}}}");
    return 0;
}
finally
{
    if (Directory.Exists(dir))
    {
        Directory.Delete(dir, true);
    }
}
