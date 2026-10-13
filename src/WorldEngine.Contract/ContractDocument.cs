using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;

namespace WorldEngine.Contract;

// The contract the command line checks its requests and answers against (src/contract.ts `RequestSchema`, `ResponseSchema`, `ScenarioSchema`,
// `SeededScenarioSchema`, `CoverageSchema`, and `describeContract`). The bundle is embedded as Schema/contract.json, generated from the
// TypeScript contract (scratchpad/gen/contract-bundle.mjs), so the schemas are the TypeScript ones and the `schema` op answers its bytes.
public static class ContractDocument
{
    private static readonly JsonNode Bundle = JsonNode.Parse(Read())!;
    private static readonly Dictionary<string, JsonSchema> Compiled = new(StringComparer.Ordinal);

    // The answer to the `schema` op: the JSON Schema of every request, and of each op's response, the failure and the version.
    public static JsonNode Describe() => Bundle["schema"]!.DeepClone();

    // A request is one object of the contract's union; a null (no request at all) is refused.
    public static bool IsRequest(JsonNode? request) => request is not null && Accepts("request", Bundle["schema"]!["request"]!, request);

    // An answer is one of the responses, or the failure any op gives a refused request (`ResponseSchema`).
    public static bool IsResponse(JsonNode? response) => response is not null &&
        Bundle["schema"]!["responses"]!.AsObject().Any(pair => Accepts($"responses/{pair.Key}", pair.Value!, response))
        || Accepts("failure", Bundle["schema"]!["failure"]!, response);

    // A scenario file is a list of entries, or a scene (`SeededScenarioSchema`).
    public static bool IsScenario(JsonNode? scenario) => scenario is not null &&
        scenario is JsonArray
            ? Accepts("scenario", Bundle["scenario"]!, scenario)
            : Accepts("seeded_scenario", Bundle["seeded_scenario"]!, scenario);

    public static bool IsCoverage(JsonNode? coverage) => coverage is not null && Accepts("coverage", Bundle["coverage"]!, coverage);

    private static bool Accepts(string name, JsonNode schema, JsonNode instance)
    {
        if (!Compiled.TryGetValue(name, out var compiled))
        {
            compiled = JsonSchema.FromText(schema.ToJsonString());
            Compiled[name] = compiled;
        }
        using var document = JsonDocument.Parse(instance.ToJsonString());
        return compiled.Evaluate(document.RootElement).IsValid;
    }

    private static string Read()
    {
        using var stream = typeof(ContractDocument).Assembly.GetManifestResourceStream("contract.json")
            ?? throw new InvalidOperationException("The contract bundle is not embedded");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
