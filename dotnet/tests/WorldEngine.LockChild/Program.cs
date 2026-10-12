using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Store;

// The other process in WorldLockProcessTests. It is not a test: it writes the world the way the CLI would, through the store, one
// request per process.
//
//   commands <dir> <who> <n>   n alternating take and drop of the world's stone, as ann; prints each answer and the version after it
//   edits <dir> <who> <n>      n author edits with default ids
//   reads <dir> <who> <n>      n fresh opens, holding no turn
var mode = args[0];
var dir = args[1];
var who = args[2];
var count = int.Parse(args[3]);
var registry = WorldFiles.ReadTemplates(dir);

switch (mode)
{
    case "commands":
    {
        var ids = WorldFiles.ReadIds(dir);
        for (var i = 0; i < count; i++)
        {
            var command = new Command(
                CommandId: $"{who}-{i}",
                Actor: ids["ann"],
                Verb: i % 2 == 0 ? "take" : "drop",
                Target: "stone");
            var result = WorldWriter.Submit(dir, registry, command);
            Console.WriteLine($"{result.CommandId} {result.Status.ToString().ToLowerInvariant()} {result.Snapshot.Version}");
        }
        break;
    }
    case "edits":
    {
        var stone = WorldFiles.ReadIds(dir)["stone"];
        for (var i = 0; i < count; i++)
        {
            var edit = new JsonObject
            {
                ["kind"] = "set_props",
                ["target"] = stone,
                ["props"] = new JsonObject { ["mark"] = $"{who}-{i}" },
            };
            WorldEdits.Edit(dir, registry, edit);
        }
        break;
    }
    case "reads":
    {
        for (var i = 0; i < count; i++)
        {
            WorldSettle.Load(dir, registry);
        }
        break;
    }
    default:
        Console.Error.WriteLine($"unknown mode {mode}");
        return 2;
}
return 0;
