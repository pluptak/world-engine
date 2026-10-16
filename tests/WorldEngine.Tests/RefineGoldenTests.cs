using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// Every case of tests/refine.test.ts as a scripted golden (Fixtures/refine-golden.expected.json, from tools/golden-gen/refine-golden.ts):
// each refusal refine has (not a refinement, too large, not a surface, contents too large, liquid over capacity, a part too sound or
// missing), the refinements that are allowed, and who may ask. Run on the shipped templates plus Fixtures/refine-templates.
public class RefineGoldenTests
{
    [Fact]
    public void Refine_script_matches_TypeScript()
    {
        var declared = new Dictionary<string, TemplateDecl>(StringComparer.Ordinal);
        foreach (var folder in new[] { "templates", "refine-templates" })
        {
            foreach (var (id, decl) in TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", folder)).Decls)
            {
                declared[id] = decl;
            }
        }
        MemoryGoldenTests.Replay("refine-golden.expected.json", TemplateResolver.Resolve(declared));
    }
}
