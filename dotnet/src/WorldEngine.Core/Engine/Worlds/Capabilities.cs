using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What the engine can compute, whatever a world declares (src/engine/capabilities.ts). A world's coverage is its choice among
// these; it may leave one out, never add one the engine has no rule for.
public static class Capabilities
{
    public static readonly IReadOnlyList<string> Relations = ["support", "contained_in", "location", "attached_to", "status", "near", "reachable"];

    public static readonly IReadOnlyList<string> Senses = ["sight", "hearing", "smell", "touch"];

    public static readonly IReadOnlyList<string> ComputedProperties = ["integrity", "residue", "pos"];

    public static bool ComputesRelation(string name) => Relations.Contains(name);

    public static bool ComputesSense(string name) => Senses.Contains(name);

    public sealed record UncomputableName(string Category, string Name);

    // The names a coverage declares that the engine cannot compute, in category then name order.
    public static IReadOnlyList<UncomputableName> Uncomputable(Coverage coverage)
    {
        var relations = coverage.Relations.Order(StringComparer.Ordinal)
            .Where(name => !ComputesRelation(name))
            .Select(name => new UncomputableName("relations", name));
        var senses = coverage.Senses.Order(StringComparer.Ordinal)
            .Where(name => !ComputesSense(name))
            .Select(name => new UncomputableName("senses", name));
        return [.. relations, .. senses];
    }
}
