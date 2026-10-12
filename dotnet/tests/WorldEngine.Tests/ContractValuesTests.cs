using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Contract;
using WorldEngine.Core.Model;
using Json.Schema;

namespace WorldEngine.Tests;

// The contract's value schemas (src/contract.ts `PosSchema`, `AnchorPosSchema`, `StatusSchema`), generated from the records, must accept
// and refuse the same sample values Zod does (Fixtures/contract-values.expected.json, from scratchpad/gen/contract-values-golden.mjs).
public class ContractValuesTests
{
    private static readonly JsonArray Rows = (JsonArray)JsonNode.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "contract-values.expected.json")))!;

    public static IEnumerable<object[]> Samples() =>
        Rows.Select(row => new object[] { row!["schema"]!.GetValue<string>(), row["value"]?.ToJsonString() ?? "null", row["valid"]!.GetValue<bool>() });

    [Theory]
    [MemberData(nameof(Samples))]
    public void The_generated_schema_judges_each_sample_as_Zod_does(string schemaName, string valueJson, bool valid)
    {
        var schema = JsonSchema.FromText(SchemaFor(schemaName).ToJsonString());
        var instance = JsonDocument.Parse(valueJson).RootElement;

        Assert.Equal(valid, schema.Evaluate(instance).IsValid);
    }

    private static JsonNode SchemaFor(string name) => name switch
    {
        "PosSchema" => ContractSchema.Of<Pos>(),
        "AnchorPosSchema" => ContractSchema.Of<AnchorPos>(),
        "StatusSchema" => ContractSchema.Of<Status>(),
        "ValidationIssueSchema" => ContractSchema.Of<ValidationIssue>(),
        "ValidationFailureSchema" => ContractSchema.Of<ValidationFailure>(),
        "CommandSchema" => ContractSchema.Of<ContractCommand>(),
        "PerceiversSchema" => ContractSchema.Of<Perceivers>(),
        "WorldEventSchema" => ContractSchema.Of<WorldEvent>(),
        "DeltaSchema" => ContractSchema.Of<Delta>(),
        _ => throw new InvalidDataException($"No .NET schema for {name}"),
    };
}
