using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// Who senses the events of a command (src/engine/query.ts `eventPerceivers`), compared with TypeScript: a human's say at
// normal, whisper and shout volume, a guest's say, a blow at a stone and at a guest's hand, a bite, and a wait. The
// commands and worlds are the ones Fixtures/perceive-golden.expected.json holds.
public class PerceiveTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["say"] = SayVerb.Say,
        ["attack"] = AttackVerb.Attack,
        ["wait"] = WaitVerb.Wait,
    };

    [Fact]
    public void Event_perceivers_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("perceive-golden.expected.json"))!.AsArray();
        Assert.NotEmpty(rows);
        var snapshots = new Dictionary<string, Snapshot>(StringComparer.Ordinal);

        foreach (var row in rows)
        {
            var name = row!["snapshot"]!.GetValue<string>();
            if (!snapshots.TryGetValue(name, out var snapshot))
            {
                snapshot = WorldJson.Read<Snapshot>(ReadFixture($"{name}.snapshot.json"));
                snapshots[name] = snapshot;
            }
            var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());
            var label = $"{name} {command.CommandId}";

            var result = Pipeline.Apply(snapshot, Registry, Verbs, command);
            var perceivers = EventPerception.EventPerceivers(snapshot, result.Snapshot, Registry, result.Events)
                .Select(entry => new Dictionary<string, object?> { ["event_id"] = entry.EventId, ["perceivers"] = entry.Perceivers })
                .ToList();

            Meaning.Same(row["perceivers"], WorldJson.Write(perceivers), $"{label}: the perceivers differ from TypeScript's");
        }
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
