using System.Text.Json.Nodes;
using System.Text.Json;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// What an observer senses (src/engine/projection.ts), each row's result compared with TypeScript's
// (Fixtures/projection-golden.expected.json, from scratchpad/gen/projection-golden.mjs): the entities an observer senses, one
// entity in detail, the level a look reads, the basis a heard sound comes from and the door it came through.
public class ProjectionGoldenTests
{
    private static readonly IReadOnlyDictionary<string, Template> Registry = TestTemplates.RepoRegistry;

    [Fact]
    public void Projection_rows_match_TypeScript()
    {
        var rows = GoldenRows.ReadRows("projection-golden.expected.json");
        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var actual = row["kind"]!.GetValue<string>() switch
            {
                "observe" => Observe(input),
                "inspect" => Inspect(input),
                "level" => Level(input),
                "heard_from" => HeardFrom(input),
                "hearing_door" => HearingDoor(input),
                var kind => throw new InvalidDataException($"{name}: unknown row kind {kind}"),
            };
            if (GoldenUpdate.Enabled)
            {
                row["result"] = actual?.DeepClone();
                continue;
            }
            Meaning.Same(row["result"], actual, $"{name}: expected {row["result"]?.ToJsonString()}, got {actual?.ToJsonString()}");
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("projection-golden.expected.json", rows);
        }
    }

    private static JsonNode? Observe(JsonNode input) => WorldJson.Node(Projection.ObserveEntities(
        WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString()),
        Registry,
        [],
        input["observer"]!.GetValue<string>()));

    private static JsonNode? Inspect(JsonNode input) => WorldJson.Node(Projection.InspectEntity(
        WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString()),
        Registry,
        [],
        input["observer"]!.GetValue<string>(),
        input["entity"]!.GetValue<string>()));

    private static JsonNode? Level(JsonNode input) => WorldJson.Node(Projection.Level(
        input["amount"]!.GetValue<long>(),
        input["full"]!.GetValue<long>(),
        input["step"]!.GetValue<long>()));

    // A basis's answer as the golden writes it: the direction, or the error a basis the table does not know raises.
    private static JsonNode HeardFrom(JsonNode input)
    {
        try
        {
            return new JsonObject { ["value"] = Projection.HeardFrom(WorldJson.Parse<Code>(input["basis"]!.GetValue<string>())) };
        }
        catch (Exception error) when (error is InvalidOperationException or JsonException)
        {
            return new JsonObject { ["error"] = "TypeError" };
        }
    }

    private static JsonNode? HearingDoor(JsonNode input) => Projection.HearingDoor(
        WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString()),
        input["observer"]!.GetValue<string>(),
        WorldJson.Read<WorldEvent>(input["event"]!.ToJsonString())) is { } door
        ? JsonValue.Create(door)
        : null;
}
