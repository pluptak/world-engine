using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// RED: part_overrides.parent must merge like any other field (src/templates.ts:641-660).
public class TemplateParentOverrideTests
{
    [Fact]
    public void Parent_override_from_json_deserializes()
    {
        var decl = WorldJson.Read<TemplateDecl>(
            """{"id":"c","extends":"r","part_overrides":{"arm":{"parent":null}}}""");

        Assert.True(decl.PartOverrides!.ContainsKey("arm"));
    }

    [Fact]
    public void Parent_override_reparents_the_part()
    {
        var root = WorldJson.Read<TemplateDecl>(
            """{"id":"root","size_cm":{"w":1,"d":1,"h":1},"mass_g":1,"parts":[{"name":"body","parent":null,"contributes":{},"detachable":false,"max_integrity":100},{"name":"arm","parent":"body","contributes":{},"detachable":false,"max_integrity":100}],"props":{},"break_products":[],"break_residue":{}}""");
        var child = WorldJson.Read<TemplateDecl>(
            """{"id":"child","extends":"root","part_overrides":{"arm":{"parent":null}}}""");

        var registry = TemplateResolver.Resolve(new Dictionary<string, TemplateDecl>
        {
            ["root"] = root,
            ["child"] = child,
        });

        Assert.Null(registry["child"].Parts.Single(p => p.Name == "arm").Parent);
    }

    [Fact]
    public void Parent_override_renames_the_parent()
    {
        var root = WorldJson.Read<TemplateDecl>(
            """{"id":"root","size_cm":{"w":1,"d":1,"h":1},"mass_g":1,"parts":[{"name":"body","parent":null,"contributes":{},"detachable":false,"max_integrity":100},{"name":"arm","parent":"body","contributes":{},"detachable":false,"max_integrity":100},{"name":"torso","parent":null,"contributes":{},"detachable":false,"max_integrity":100}],"props":{},"break_products":[],"break_residue":{}}""");
        var child = WorldJson.Read<TemplateDecl>(
            """{"id":"child","extends":"root","part_overrides":{"arm":{"parent":"torso"}}}""");

        var registry = TemplateResolver.Resolve(new Dictionary<string, TemplateDecl>
        {
            ["root"] = root,
            ["child"] = child,
        });

        Assert.Equal("torso", registry["child"].Parts.Single(p => p.Name == "arm").Parent);
    }
}
