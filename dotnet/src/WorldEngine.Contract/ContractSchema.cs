using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;
using System.Text.Json.Serialization.Metadata;
using WorldEngine.Core.Json;

namespace WorldEngine.Contract;

// The JSON Schema (draft 2020-12) of a contract type, generated from its record (src/contract.ts `z.toJSONSchema`). The exporter closes
// every object to the members it names (Zod's `.strict()`), and a type that is not optional is not nullable. What the generator cannot say from the record alone is set afterwards, in one place, so each such constraint is visible: a
// name that must not be empty.
public static class ContractSchema
{
    // A copy of the shared options with the reflection resolver the exporter reads types through.
    private static readonly JsonSerializerOptions Options = new(WorldJson.Options) { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };

    public static JsonNode Of<T>()
    {
        var schema = JsonSchemaExporter.GetJsonSchemaAsNode(
            Options,
            typeof(T),
            new JsonSchemaExporterOptions { TreatNullObliviousAsNonNullable = true });
        if (typeof(T) == typeof(AnchorPos))
        {
            schema["properties"]!["anchor"]!["minLength"] = 1;
        }
        return schema;
    }
}
