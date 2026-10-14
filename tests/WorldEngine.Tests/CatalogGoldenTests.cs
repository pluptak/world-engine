using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The verb catalog (src/engine/verbs/index.ts `verbCatalog`): every verb's declared args, duration, requirements, capacity
// data and refusals, compared with TypeScript's catalog as a whole (Fixtures/catalog-golden.expected.json, from
// scratchpad/gen/catalog-dump.mjs). Also the pipeline's rule that a refusal a verb did not declare is a bug.
public class CatalogGoldenTests
{
    [Fact]
    public void Catalog_matches_TypeScript()
    {
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("catalog-golden.expected.json", VerbRegistry.Catalog());
            return;
        }
        var expected = GoldenRows.ReadRows("catalog-golden.expected.json");
        Assert.True(
            CanonicalJson.Serialize(expected) == CanonicalJson.Serialize(VerbRegistry.Catalog()),
            "the catalog differs from TypeScript's");
    }

    // A verb that needs a capacity refuses a body short of it with that capacity's own code, which the verb declares.
    [Fact]
    public void Every_capacity_a_verb_requires_has_its_declared_refusal()
    {
        foreach (var (name, verb) in VerbRegistry.All)
        {
            foreach (var requirement in verb.Requires ?? [])
            {
                Assert.Contains(Pipeline.Insufficient(requirement.Capacity), VerbSpecs.ByVerb[name].Refuses);
            }
        }
    }

    [Fact]
    public void A_refusal_the_verb_did_not_declare_throws()
    {
        var snapshot = WorldJson.Read<Snapshot>(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "edit-base.snapshot.json")));
        var undeclared = WaitVerb.Wait with
        {
            Preconditions = _ => new Pipeline.Refusal(Status.Refused, Code.Locked),
        };
        var verbs = new Dictionary<string, Pipeline.VerbDecl> { ["wait"] = undeclared };
        var command = new Command("c1", "e4", "wait", Args: new Dictionary<string, JsonNode?> { ["ticks"] = JsonValue.Create(1L) });

        var error = Assert.Throws<InvalidOperationException>(() => Pipeline.Apply(snapshot, TestTemplates.RepoRegistry, verbs, command));
        Assert.Equal("Verb wait refused with undeclared code locked", error.Message);
    }
}
