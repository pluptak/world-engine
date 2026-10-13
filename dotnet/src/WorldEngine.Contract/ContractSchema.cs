using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;
using System.Text.Json.Serialization.Metadata;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Contract;

// The JSON Schema (draft 2020-12) of a contract type, generated from its record (src/contract.ts `z.toJSONSchema`). The exporter closes
// every object to the members it names (Zod's `.strict()`), and a type that is not optional is not nullable. What the exporter cannot say
// from the record is set afterwards, here, so each such constraint is visible in one place: a name that must not be empty, a literal
// status, a path element that is a string or a number, and an issue that allows members beyond its own.
public static class ContractSchema
{
    // A copy of the shared options with the reflection resolver the exporter reads types through.
    private static readonly JsonSerializerOptions Options = new(WorldJson.Options) { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };

    public static JsonNode Of<T>()
    {
        JsonNode schema = Generate<T>();
        if (typeof(T) == typeof(AnchorPos))
        {
            schema["properties"]!["anchor"]!["minLength"] = 1;
        }
        else if (typeof(T) == typeof(Entity))
        {
            var properties = schema["properties"]!;
            // An entity's integrity is a percentage, and each prop is a number, a string or a boolean.
            properties["integrity"]!["minimum"] = 0;
            properties["integrity"]!["maximum"] = 100;
            properties["props"]!["additionalProperties"] = JsonNode.Parse("""{"anyOf":[{"type":"number"},{"type":"string"},{"type":"boolean"}]}""");
            // Zod's traits is optional; the record names it without a default, so it is taken off the required list here.
            schema["required"] = JsonSerializer.SerializeToNode(
                schema["required"]!.AsArray().Select(name => name!.GetValue<string>()).Where(name => name != "traits").ToArray());
        }
        else if (typeof(T) == typeof(PartState))
        {
            // A part's integrity is a percentage of its maximum.
            schema["properties"]!["integrity"]!["minimum"] = 0;
            schema["properties"]!["integrity"]!["maximum"] = 100;
        }
        else if (typeof(T) == typeof(ValidationIssue))
        {
            IssueConstraints(schema);
        }
        else if (typeof(T) == typeof(ValidationFailure))
        {
            schema["properties"]!["status"] = JsonNode.Parse("""{"const":"invalid","type":"string"}""");
            // The issue is inlined, or named in $defs when it is referenced from elsewhere; either way it is the items of `issues`.
            var issue = schema["properties"]!["issues"]!["items"]!;
            IssueConstraints(issue["$ref"] is null ? issue : schema["$defs"]!["ValidationIssue"]!);
        }
        return schema;
    }

    private static JsonNode Generate<T>()
    {
        return JsonSchemaExporter.GetJsonSchemaAsNode(
            Options,
            typeof(T),
            new JsonSchemaExporterOptions { TreatNullObliviousAsNonNullable = true });
    }

    private static void IssueConstraints(JsonNode issue)
    {
        issue["additionalProperties"] = true;
        issue["properties"]!["path"]!["items"] = JsonNode.Parse("""{"anyOf":[{"type":"string"},{"type":"number"}]}""");
    }
}
