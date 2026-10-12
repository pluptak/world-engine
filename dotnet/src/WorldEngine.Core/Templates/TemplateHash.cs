using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;

namespace WorldEngine.Core.Templates;

// The hash a snapshot carries as templates_hash (src/templates.ts templatesHash): SHA-256, in hex, of
// the canonical JSON of the resolved set. Each template's lineage is left out: it records where the
// template came from, not what it is.
public static class TemplateHash
{
    public static string Of(JsonObject registry)
    {
        var plain = new JsonObject();
        foreach (var (id, template) in registry)
        {
            var copy = template is JsonObject record
                ? (JsonObject)record.DeepClone()
                : throw new FormatException($"Template {id} is not an object");
            copy.Remove("lineage");
            plain[id] = copy;
        }

        var bytes = Encoding.UTF8.GetBytes(CanonicalJson.Serialize(plain));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}
