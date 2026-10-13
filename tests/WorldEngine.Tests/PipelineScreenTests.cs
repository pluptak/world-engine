using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The front of `apply` (src/engine/pipeline.ts) against TypeScript: each command from front-commands.json run on
// each variant of the rich world. A row with a result is a command the front refuses; a row with `null` is one that
// goes on to its verb, which the front must not refuse. The verb declarations are the two the commands use.
public class PipelineScreenTests
{
    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["take"] = new(RequiresTarget: true, AuthorOnly: false),
        ["edit"] = new(RequiresTarget: false, AuthorOnly: true),
    };

    [Fact]
    public void The_front_screens_each_command_as_TypeScript_does()
    {
        var rows = JsonNode.Parse(ReadFixture("pipeline-screen.expected.json"))!.AsArray();
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
            var screened = Pipeline.Screen(snapshot, Registry, Verbs, command);

            var expected = row["result"];
            if (expected is null)
            {
                Assert.True(screened is null, $"{label}: TypeScript goes on to the verb, but the front refused it");
                continue;
            }
            Assert.True(screened is not null, $"{label}: TypeScript refuses it, but the front let it through");
            Assert.True(
                CanonicalJson.Serialize(expected) == WorldJson.Write(Shape(screened)),
                $"{label}: the front's result differs from TypeScript's");
        }
    }

    private static Dictionary<string, object?> Shape(Pipeline.Result result)
    {
        var shape = new Dictionary<string, object?>
        {
            ["status"] = result.Status.ToString().ToLowerInvariant(),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
        };
        if (result.Candidates is not null)
        {
            shape["candidates"] = result.Candidates.ToList();
        }
        if (result.ReasonCode is not null)
        {
            shape["reason_code"] = result.ReasonCode;
        }
        if (result.ReasonData is not null)
        {
            shape["reason_data"] = result.ReasonData.ToDictionary(entry => entry.Key, entry => (object?)entry.Value);
        }
        return shape;
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
