using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The registry the engine tests run against: the repo's templates (Fixtures/templates), plus the test templates a thing
// needs to be used up or broken (Fixtures/test-templates: stale_bread, fragile_crate). Those live apart so the frozen
// registry fixture still matches the repo's own set.
public static class TestTemplates
{
    public static IReadOnlyDictionary<string, Template> Registry { get; } = TemplateResolver.Resolve(Declarations());

    private static IReadOnlyDictionary<string, TemplateDecl> Declarations()
    {
        var declared = new Dictionary<string, TemplateDecl>(StringComparer.Ordinal);
        foreach (var folder in new[] { "templates", "test-templates" })
        {
            var set = TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", folder));
            foreach (var (id, decl) in set.Decls)
            {
                declared[id] = decl;
            }
        }
        return declared;
    }
}
