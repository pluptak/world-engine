using System.Text.Json.Nodes;
using WorldEngine.Host;

// dotnet run --project tools/WorldEngine.Host -- <scene.json> <plan.json> <dir>
if (args.Length != 3)
{
    Console.Error.WriteLine("usage: WorldEngine.Host <scene.json> <plan.json> <dir>");
    return 2;
}
var plan = JsonNode.Parse(File.ReadAllText(args[1]))!.AsObject();
var timeout = (int)plan["timeout_ms"]!;
var players = plan["handles"]!.AsObject().ToDictionary(p => p.Key, p => HostRun.Scripted(p.Value!["moves"]!.AsArray(), timeout));
var result = await HostRun.Play(args[0], plan, args[2], players);
Console.WriteLine(new JsonObject
{
    ["status"] = "ok",
    ["rounds"] = result.Rounds,
    ["ended"] = result.Ended,
    ["dropped"] = new JsonArray(result.Dropped.Select(d => (JsonNode)new JsonObject { ["round"] = d.Round, ["handle"] = d.Handle }).ToArray()),
}.ToJsonString());
return 0;
