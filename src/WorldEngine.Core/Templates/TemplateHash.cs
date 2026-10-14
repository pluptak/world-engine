using System.Security.Cryptography;
using System.Text;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Templates;

// The hash a snapshot carries as templates_hash (src/templates.ts templatesHash): SHA-256, in hex, of
// the canonical JSON of the resolved set. Each template's lineage is left out: it records where the
// template came from, not what it is.
public static class TemplateHash
{
    public static string Of(IReadOnlyDictionary<string, Template> registry)
    {
        var plain = Value.Of(registry.Select(pair => KeyValuePair.Create(pair.Key, ValueJson.Of(pair.Value with { Lineage = null }))));
        var bytes = Encoding.UTF8.GetBytes(CanonicalJson.Serialize(plain));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }
}
