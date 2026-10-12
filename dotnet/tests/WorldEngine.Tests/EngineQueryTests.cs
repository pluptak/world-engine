using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// What an observer senses now, what an actor can address, and which name resolves, run by src/engine/query.ts and
// src/engine/resolve.ts over the rich fixtures: a hall with a door to the room, a lamp, a camera and an intercom on
// a generator, a crate with a bead inside it, and a rag concealed under the doorstop. `rich-lit` lights the room.
public class EngineQueryTests
{
    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    [Theory]
    [InlineData("rich-dark")]
    [InlineData("rich-lit")]
    [InlineData("rich-away")]
    [InlineData("rich-open")]
    public void Engine_answers_match_TypeScript(string name)
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture($"{name}.snapshot.json"));
        var expected = JsonNode.Parse(ReadFixture($"engine-{name}.expected.json"))!;

        var addressable = expected["addressable"]!.AsArray().Select(row =>
        {
            var actor = row!["actor"]!.GetValue<string>();
            var entity = row["entity"]!.GetValue<string>();
            return new Dictionary<string, object?>
            {
                ["actor"] = actor,
                ["entity"] = entity,
                ["value"] = Perception.Addressable(snapshot, Registry, actor, entity),
            };
        }).ToList();

        var perceive = expected["perceive"]!.AsArray().Select(row =>
        {
            var observer = row!["observer"]!.GetValue<string>();
            var entity = row["entity"]!.GetValue<string>();
            var sense = row["sense"]!.GetValue<string>();
            var answer = Perception.Perceive(snapshot, Registry, observer, entity, sense);
            return new Dictionary<string, object?>
            {
                ["observer"] = observer,
                ["entity"] = entity,
                ["sense"] = sense,
                ["result"] = new Dictionary<string, object?> { ["value"] = answer.Value, ["basis_code"] = answer.BasisCode },
            };
        }).ToList();

        var resolve = expected["resolve"]!.AsArray().Select(row =>
        {
            var actor = row!["actor"]!.GetValue<string>();
            var text = row["text"]!.GetValue<string>();
            return new Dictionary<string, object?>
            {
                ["actor"] = actor,
                ["text"] = text,
                ["result"] = ResolveTests.Shape(Resolve.ResolveTarget(snapshot, Registry, actor, text)),
            };
        }).ToList();

        var result = new Dictionary<string, object?>
        {
            ["addressable"] = addressable,
            ["perceive"] = perceive,
            ["resolve"] = resolve,
        };

        Assert.Equal(CanonicalJson.Serialize(expected), WorldJson.Write(result));
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
