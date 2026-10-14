using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// Which field a new template set would take away from a live entity (src/engine/upgrade.ts), each row's result compared with
// TypeScript's (Fixtures/upgrade-golden.expected.json, from scratchpad/gen/upgrade-golden.mjs). Each row names the registry
// variant it was judged against, and this test rebuilds that variant from the shipped templates in the same way.
public class UpgradeGoldenTests
{
    [Fact]
    public void Upgrade_rows_match_TypeScript()
    {
        foreach (var row in GoldenRows.ReadRows("upgrade-golden.expected.json"))
        {
            var name = row!["name"]!.GetValue<string>();
            var input = row["input"]!;
            var snapshot = WorldJson.Read<Snapshot>(input["snapshot"]!.ToJsonString());
            var registry = Variant(input["variant"]!.GetValue<string>());
            var actual = row["kind"]!.GetValue<string>() switch
            {
                "lost" => Lost(snapshot, registry),
                "assert" => AssertOutcome(snapshot, registry),
                var kind => throw new InvalidDataException($"{name}: unknown row kind {kind}"),
            };
            Meaning.Same(row["result"], actual, $"{name}: the result differs from TypeScript's");
        }
    }

    private static JsonNode? Lost(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry) =>
        Upgrade.Lost(snapshot, registry) is { } lost
            ? new JsonObject { ["entity"] = lost.Entity, ["template"] = lost.Template, ["field"] = lost.Field }
            : null;

    private static JsonNode AssertOutcome(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry)
    {
        try
        {
            Upgrade.AssertNoLost(snapshot, registry);
            return new JsonObject { ["status"] = "ok" };
        }
        catch (WorldError error)
        {
            return new JsonObject { ["status"] = "error", ["code"] = WorldJson.Name(error.Code), ["message"] = error.Message };
        }
    }

    // The shipped templates changed in the named way the golden's generator changed them.
    private static IReadOnlyDictionary<string, Template> Variant(string name)
    {
        var shipped = TestTemplates.RepoRegistry;
        return name switch
        {
            "shipped" => shipped,
            "no_hand" => WithoutPart(shipped, "human", "hand_l"),
            "no_head" => WithoutPart(shipped, "human", "head"),
            "no_bottle" => Without(shipped, "bottle"),
            "bottle_breaks_into_ghost" => Changed(shipped, "bottle", bottle => bottle with { BreakProducts = [new Product("ghost", 1)] }),
            "bottle_spends_into_ghost" => Changed(shipped, "bottle", bottle => bottle with { SpentProducts = [new Product("ghost", 1)] }),
            "no_hand_no_bottle" => WithoutPart(Without(shipped, "bottle"), "human", "hand_l"),
            _ => throw new InvalidDataException($"unknown registry variant {name}"),
        };
    }

    private static IReadOnlyDictionary<string, Template> WithoutPart(IReadOnlyDictionary<string, Template> registry, string id, string part) =>
        Changed(registry, id, template => template with { Parts = [.. template.Parts.Where(decl => decl.Name != part)] });

    private static IReadOnlyDictionary<string, Template> Without(IReadOnlyDictionary<string, Template> registry, string id)
    {
        var copy = new Dictionary<string, Template>(registry, StringComparer.Ordinal);
        copy.Remove(id);
        return copy;
    }

    private static IReadOnlyDictionary<string, Template> Changed(
        IReadOnlyDictionary<string, Template> registry,
        string id,
        Func<Template, Template> change)
    {
        var copy = new Dictionary<string, Template>(registry, StringComparer.Ordinal);
        copy[id] = change(registry[id]);
        return copy;
    }
}
