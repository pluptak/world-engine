using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// `apply` of each verb (src/engine/verbs/*.ts through src/engine/pipeline.ts), whole results compared with TypeScript: status,
// target, snapshot, deltas and events, the refusal and its data. Each golden (Fixtures/<name>-golden.expected.json) names the
// snapshot and the command of every row; the hand-picked cases each one holds are listed beside it below. VerbMatrixTests runs
// every verb over every fixture snapshot; these are the edge cases it does not reach.
public class VerbGoldenTests
{
    // A golden, the verbs it is applied with, and whether its worlds read the shipped templates alone (the repo set) or with the
    // test templates beside them.
    private sealed record Golden(string Fixture, bool RepoOnly, string[] Verbs);

    private static readonly Golden[] Goldens =
    [
        // The front, the reach, gap and carry refusals, the grip checks, the weight check, and the reveal of what the item hid.
        new("take-golden.expected.json", true, ["advance", "take"]),
        // The carried and pocket refusals, a held rag falling, a bottle breaking into shards on the floor or spilling on a table.
        new("drop-golden.expected.json", true, ["advance", "drop"]),
        // A bottle handed into either or a named grip; full hands, a weak guest, far, a chest, a non-agent, oneself, bad parts, a pocket.
        new("give-golden.expected.json", false, ["advance", "give"]),
        // On a table and into an open chest; closed, far, non-surface, non-container, overfull pocket; out of the pocket onto a table.
        new("put-golden.expected.json", false, ["advance", "put"]),
        // All or part of a bottle onto a table, into a chest, on the floor; bad sources and destinations; incompatible and full.
        new("pour-golden.expected.json", false, ["pour"]),
        // The front, reach and enclosure refusals, manipulation on a weakened human, the found events, the clock's tick.
        new("search-golden.expected.json", true, ["advance", "search"]),
        // Walks in a room (clear, blocked, out of footprint, in place), through shut and open doors by name or alias, bad arguments.
        new("move-golden.expected.json", false, ["move"]),
        // Doors opened, closed, locked and unlocked with a key; a closing window, a chest the clock shuts; non-openable, far, unknown.
        new("open-golden.expected.json", false, ["open", "close", "lock", "unlock"]),
        // Stones slid clear, stopped, breaking a bottle; pulled; a table, a blocked chest, held, own body, far, bad arguments, a part.
        new("push-golden.expected.json", false, ["push", "pull"]),
        // Tokens at each volume, addressed and whispered; bad tokens, volumes, addressees, and a dog with no speech.
        new("say-golden.expected.json", false, ["say"]),
        // Lamps and a generator switched; intercoms worked from afar, one unpowered; out of reach, a stone, a hand, unknown, none.
        new("switch-golden.expected.json", false, ["switch_on", "switch_off"]),
        // Lamps lit and doused, already lit or out, shut in a chest, out of reach; non-lights, a held thing, a missing target.
        new("light-golden.expected.json", false, ["light", "douse"]),
        // Waits of several spans and bad counts, an unknown `until`, a non-agent; a wait in which a chest's shut falls due.
        new("wait-golden.expected.json", false, ["wait"]),
        // Strikes to a torso, a hand, a stone, a bite, oneself; reach, part and target refusals; a hand that comes off and bleeds.
        new("attack-golden.expected.json", false, ["attack"]),
        // A wound bleeding three times to its end, and in a body it destroys, the held bottle falling and breaking.
        new("bleed-golden.expected.json", false, ["wait"]),
        // Waits ended at the first tick the waiter senses something (a chest shutting, a bleed), one that runs its span, bad `until`.
        new("sensed-golden.expected.json", false, ["wait"]),
        // The author's advance with `stop_on_perceived`: stopping at the first sensed tick, running its span, the watcher refusals.
        new("advance-stop-golden.expected.json", false, ["advance"]),
        // The author's advance on the rich world and on one whose modifiers expire at different ticks.
        new("advance-golden.expected.json", true, ["advance"]),
        // Liquid drunk by amount or whole (hunger lowered or none), the refusals, bread a portion at a time, a bottle on a table.
        new("consume-golden.expected.json", false, ["advance", "consume"]),
        // A solid's last portion used up (`Physical.SpendEntity`) in the hand and on a table, releasing the stone on it.
        new("consume-spent-golden.expected.json", false, ["advance", "consume"]),
        // Things that lose their support (`propagateSupportLoss`): bottles off a used-up bread spill, a dropped crate breaks.
        new("loss-golden.expected.json", false, ["advance", "consume", "drop"]),
    ];

    [Fact]
    public void Every_verb_golden_gives_TypeScripts_results()
    {
        var differing = new List<string>();
        var total = 0;
        foreach (var golden in Goldens)
        {
            var registry = golden.RepoOnly ? TestTemplates.RepoRegistry : TestTemplates.Registry;
            var verbs = golden.Verbs.ToDictionary(name => name, name => VerbRegistry.All[name], StringComparer.Ordinal);
            var rows = JsonNode.Parse(ReadFixture(golden.Fixture))!.AsArray();
            Assert.True(rows.Count > 0, $"{golden.Fixture} holds no rows");
            var snapshots = new Dictionary<string, Snapshot>(StringComparer.Ordinal);
            foreach (var row in rows)
            {
                total += 1;
                var name = row!["snapshot"]!.GetValue<string>();
                if (!snapshots.TryGetValue(name, out var snapshot))
                {
                    snapshot = WorldJson.Read<Snapshot>(ReadFixture($"{name}.snapshot.json"));
                    snapshots[name] = snapshot;
                }
                var command = WorldJson.Read<Command>(row["command"]);
                var result = Pipeline.Apply(snapshot, registry, verbs, command);
                if (CanonicalJson.Serialize(row["result"]) != WorldJson.Write(Shape(result)))
                {
                    differing.Add($"{golden.Fixture} {name} {command.CommandId}");
                }
            }
        }
        Assert.True(differing.Count == 0, $"{differing.Count} of {total} differ from TypeScript's, first: {string.Join(" | ", differing.Take(8))}");
    }

    private static Dictionary<string, object?> Shape(Pipeline.Result result)
    {
        var shape = new Dictionary<string, object?>
        {
            ["status"] = result.Status.ToString().ToLowerInvariant(),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
            ["snapshot"] = result.Snapshot,
            ["deltas"] = result.Deltas,
            ["events"] = result.Events,
        };
        if (result.ReasonCode is not null)
        {
            shape["reason_code"] = result.ReasonCode;
        }
        if (result.ReasonData is not null)
        {
            shape["reason_data"] = result.ReasonData;
        }
        if (result.Candidates is not null)
        {
            shape["candidates"] = result.Candidates;
        }
        return shape;
    }

    private static string ReadFixture(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
