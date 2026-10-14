using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// What a fixture writes as JSON, as the engine reads it once the contract has checked it.
internal static class Values
{
    public static Value? Of(JsonNode? node) => ValueJson.FromNode(node);
}

internal static class Edits
{
    public static Value.Map Of(JsonNode? edit) => (Value.Map)Values.Of(edit)!;
}
