using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The 52 template files of templates/, resolved, must give the registry the TypeScript engine froze into a
// world (bottle.templates.json): 59 templates, the 7 inherited companions among them.
public class TemplateResolverTests
{
    [Fact]
    public void Resolves_the_frozen_registry()
    {
        var registry = TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(FixtureDirectory("templates")));

        Meaning.Same(ReadFixture("bottle.templates.json"), WorldJson.Write(registry), "the resolved registry");
    }

    [Fact]
    public void A_child_part_override_replaces_only_the_field_it_names()
    {
        var registry = Resolve(FixtureDeclarations());

        var jaw = registry["cat"].Parts.Single(part => part.Name == "jaw");

        Assert.Equal(20, jaw.MaxIntegrity);
        Assert.Equal(registry["quadruped"].Parts.Single(part => part.Name == "jaw").Contributes, jaw.Contributes);
    }

    [Fact]
    public void Catalog_hiding_is_not_inherited()
    {
        var registry = Resolve(FixtureDeclarations());

        Assert.False(registry["quadruped"].Catalog);
        Assert.Null(registry["cat"].Catalog);
    }

    [Fact]
    public void A_cycle_is_refused_with_its_chain()
    {
        var decls = new Dictionary<string, TemplateDecl>
        {
            ["a"] = new TemplateDecl("a", Extends: "b"),
            ["b"] = new TemplateDecl("b", Extends: "a"),
        };

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(decls));

        Assert.Equal("Template extends cycle: a -> b -> a", error.Message);
    }

    [Fact]
    public void An_unknown_parent_is_refused_with_its_chain()
    {
        var decls = new Dictionary<string, TemplateDecl> { ["a"] = new TemplateDecl("a", Extends: "missing") };

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(decls));

        Assert.Equal("Template extends unknown parent: a -> missing", error.Message);
    }

    [Fact]
    public void An_override_of_a_part_the_parent_lacks_is_refused()
    {
        var decls = new Dictionary<string, TemplateDecl>
        {
            ["root"] = Root("root", parts: [new PartDecl("arm", null, new Dictionary<string, long>(), false, 100)]),
            ["child"] = new TemplateDecl(
                "child",
                Extends: "root",
                PartOverrides: new Dictionary<string, PartOverride> { ["leg"] = new PartOverride(MaxIntegrity: 5) }),
        };

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(decls));

        Assert.Equal("child part_overrides names leg, which it inherits no part of", error.Message);
    }

    [Fact]
    public void A_root_with_no_full_declaration_is_refused_with_what_is_missing()
    {
        var decls = new Dictionary<string, TemplateDecl> { ["bare"] = new TemplateDecl("bare") };

        var error = Assert.Throws<FormatException>(() => TemplateResolver.Resolve(decls));

        Assert.Equal(
            "bare declares no size_cm or mass_g or parts or props or break_products or break_residue and extends nothing",
            error.Message);
    }

    private static TemplateDecl Root(string id, IReadOnlyList<PartDecl> parts) =>
        new(
            id,
            SizeCm: new Dimensions(1, 1, 1),
            MassG: 1,
            Parts: parts,
            Props: Value.Map.Empty,
            BreakProducts: [],
            BreakResidue: new Dictionary<string, long>());

    private static IReadOnlyDictionary<string, Template> Resolve(DeclaredSet declared) =>
        TemplateResolver.Resolve(declared);

    private static DeclaredSet FixtureDeclarations() =>
        TemplateDirectory.ReadDeclarations(FixtureDirectory("templates"));

    private static string FixtureDirectory(string name) =>
        Path.Combine(AppContext.BaseDirectory, "Fixtures", name);

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
