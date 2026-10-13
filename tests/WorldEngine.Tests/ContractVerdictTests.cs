using System.Text.Json.Nodes;
using WorldEngine.Cli;
using WorldEngine.Contract;

namespace WorldEngine.Tests;

// The contract the command line checks against (src/contract.ts), judged the way Zod judges: every sample of Fixtures/contract-verdicts
// .expected.json (requests, answers, scenarios and coverage, the goldens' own and mutations of them, from scratchpad/gen/
// contract-verdicts-golden.mjs) is accepted or refused exactly as TypeScript's schema does. The `schema` op answers the bundle's bytes.
public class ContractVerdictTests
{
    private static readonly string Fixtures = Path.Combine(AppContext.BaseDirectory, "Fixtures");
    private static readonly JsonObject Verdicts = (JsonObject)JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "contract-verdicts.expected.json")))!;

    public static IEnumerable<object?[]> Samples(string group) =>
        ((JsonArray)Verdicts[group]!).Select((row, index) => new object?[] { index, row!["sample"]?.DeepClone(), row["valid"]!.GetValue<bool>() });

    public static IEnumerable<object?[]> Requests() => Samples("requests");
    public static IEnumerable<object?[]> Responses() => Samples("responses");
    public static IEnumerable<object?[]> Scenarios() => Samples("scenarios");
    public static IEnumerable<object?[]> Coverage() => Samples("coverage");

    [Theory]
    [MemberData(nameof(Requests))]
    public void A_request_is_accepted_as_TypeScript_accepts_it(int index, JsonNode? sample, bool valid) =>
        Assert.True(ContractDocument.IsRequest(sample) == valid, $"request sample {index}: Zod says {valid}");

    [Theory]
    [MemberData(nameof(Responses))]
    public void An_answer_is_accepted_as_TypeScript_accepts_it(int index, JsonNode? sample, bool valid) =>
        Assert.True(ContractDocument.IsResponse(sample) == valid, $"response sample {index}: Zod says {valid}");

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void A_scenario_is_accepted_as_TypeScript_accepts_it(int index, JsonNode? sample, bool valid) =>
        Assert.True(ContractDocument.IsScenario(sample) == valid, $"scenario sample {index}: Zod says {valid}");

    [Theory]
    [MemberData(nameof(Coverage))]
    public void A_coverage_is_accepted_as_TypeScript_accepts_it(int index, JsonNode? sample, bool valid) =>
        Assert.True(ContractDocument.IsCoverage(sample) == valid, $"coverage sample {index}: Zod says {valid}");

    [Fact]
    public void The_schema_op_answers_the_bytes_TypeScript_answers()
    {
        var golden = File.ReadAllText(Path.Combine(Fixtures, "cli-schema.expected.json"));
        Assert.Equal(golden, CliRunner.Run([], "{\"op\":\"schema\"}").Stdout);
    }
}
