using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// An edit a fixture writes as JSON, as the engine reads it once the contract has checked the request.
internal static class Edits
{
    public static Value.Map Of(JsonNode? edit) => (Value.Map)ValueJson.FromNode(edit)!;
}
