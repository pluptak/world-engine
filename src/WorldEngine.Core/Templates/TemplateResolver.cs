using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Templates;

// Resolution of declared templates into the set a world stores (src/templates.ts resolveTemplates). It
// runs once, here: everything downstream sees no `extends`, so the hash and a frozen templates.json never
// need to know a parent existed. Parts, props and products are validated as each template resolves.
public static class TemplateResolver
{
    public static IReadOnlyDictionary<string, Template> Resolve(IReadOnlyDictionary<string, TemplateDecl> declared) =>
        Resolve(new DeclaredSet(declared, new Dictionary<string, string>()));

    public static IReadOnlyDictionary<string, Template> Resolve(DeclaredSet declared)
    {
        var decls = new Dictionary<string, TemplateDecl>(declared.Decls);
        var sources = new Dictionary<string, string>(declared.Sources);
        foreach (var decl in decls.Values)
        {
            TemplateValidation.CheckDeclaration(decl, SourceOf(sources, decl.Id));
        }
        for (;;)
        {
            var registry = ResolveAll(decls, sources);
            var inherited = InheritedCompanions(registry, decls);
            if (inherited.Count == 0)
            {
                AssertNoMissingCompanions(registry);
                TemplateValidation.AssertProducts(registry, sources);
                TemplateValidation.AssertSuccessors(registry);
                return registry;
            }
            foreach (var (id, parent) in inherited)
            {
                decls[id] = new TemplateDecl(id, Extends: parent);
                sources[id] = $"{parent} (inherited)";
            }
        }
    }

    private static string SourceOf(IReadOnlyDictionary<string, string> sources, string id) =>
        sources.GetValueOrDefault(id, id);

    // The companions a template needs for its detachable parts and does not have (`<id>.<part>`).
    public static IReadOnlyList<string> MissingCompanions(IReadOnlyDictionary<string, Template> registry)
    {
        var missing = new List<string>();
        foreach (var template in registry.Values)
        {
            foreach (var part in template.Parts)
            {
                if (part.Detachable)
                {
                    var companionId = $"{template.Id}.{part.Name}";
                    if (!registry.ContainsKey(companionId))
                    {
                        missing.Add(companionId);
                    }
                }
            }
        }
        missing.Sort(StringComparer.Ordinal);
        return missing;
    }

    private static void AssertNoMissingCompanions(IReadOnlyDictionary<string, Template> registry)
    {
        var missing = MissingCompanions(registry);
        if (missing.Count > 0)
        {
            throw new FormatException($"Missing detached part template {missing[0]}");
        }
    }

    // The ids from a template up to its root, child first. A cycle or an unknown parent is refused here,
    // with the chain that produced it.
    private static List<string> Ancestry(string id, IReadOnlyDictionary<string, TemplateDecl> decls)
    {
        var chain = new List<string>();
        var seen = new HashSet<string>();
        string? current = id;
        while (current is not null)
        {
            if (seen.Contains(current))
            {
                throw new FormatException($"Template extends cycle: {string.Join(" -> ", chain.Append(current))}");
            }
            if (!decls.TryGetValue(current, out var decl))
            {
                throw new FormatException($"Template extends unknown parent: {string.Join(" -> ", chain.Append(current))}");
            }
            seen.Add(current);
            chain.Add(current);
            current = decl.Extends;
        }
        return chain;
    }

    private static Dictionary<string, Template> ResolveAll(
        IReadOnlyDictionary<string, TemplateDecl> decls,
        IReadOnlyDictionary<string, string> sources)
    {
        var registry = new Dictionary<string, Template>();
        foreach (var id in decls.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var chain = Ancestry(id, decls);
            var template = RequireResolved(decls[chain[^1]], SourceOf(sources, chain[^1]));
            foreach (var chainId in Enumerable.Reverse(chain.Take(chain.Count - 1)))
            {
                template = OverParent(template, decls[chainId]);
            }
            var source = SourceOf(sources, id);
            TemplateValidation.ValidateParts(template, source);
            TemplateValidation.ValidateMaxIntegrity(template, source);
            TemplateValidation.ValidateProps(template, source);
            registry[id] = template;
        }
        return registry;
    }

    // The companions a child lacks that its parent has: `<child>.<part>` extending `<parent>.<part>`, for a
    // detachable part the child has because it declares no parts of its own.
    private static List<(string Id, string Parent)> InheritedCompanions(
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, TemplateDecl> decls)
    {
        var found = new List<(string Id, string Parent)>();
        foreach (var id in registry.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var decl = decls.GetValueOrDefault(id);
            if (decl is null || decl.Extends is null || decl.Parts is not null)
            {
                continue;
            }
            foreach (var part in registry[id].Parts)
            {
                var own = $"{id}.{part.Name}";
                var inherited = $"{decl.Extends}.{part.Name}";
                if (part.Detachable && !decls.ContainsKey(own) && decls.ContainsKey(inherited))
                {
                    found.Add((own, inherited));
                }
            }
        }
        return found;
    }

    private static Template RequireResolved(TemplateDecl decl, string source)
    {
        if (decl.PartOverrides is not null)
        {
            throw new FormatException($"{source} declares part_overrides and extends nothing");
        }
        var missing = new List<string>();
        if (decl.SizeCm is null) missing.Add("size_cm");
        if (decl.MassG is null) missing.Add("mass_g");
        if (decl.Parts is null) missing.Add("parts");
        if (decl.Props is null) missing.Add("props");
        if (decl.BreakProducts is null) missing.Add("break_products");
        if (decl.BreakResidue is null) missing.Add("break_residue");
        if (missing.Count > 0)
        {
            throw new FormatException($"{source} declares no {string.Join(" or ", missing)} and extends nothing");
        }

        return new Template(
            Id: decl.Id,
            SizeCm: decl.SizeCm!,
            MassG: decl.MassG!.Value,
            Parts: CopyParts(decl.Parts!),
            Props: PropsOf(decl.Props!),
            BreakProducts: CopyProducts(decl.BreakProducts!),
            BreakResidue: new Dictionary<string, long>(decl.BreakResidue!),
            SpentProducts: NonEmptyProducts(decl.SpentProducts),
            SpentResidue: NonEmptyResidue(decl.SpentResidue),
            Lineage: decl.Lineage is { Count: > 0 } lineage ? lineage.ToList() : null,
            Catalog: decl.Catalog == false ? false : null,
            MaxIntegrity: decl.MaxIntegrity,
            Processes: NonEmptyProcesses(decl.Processes),
            Fields: NonEmptyFields(decl.Fields));
    }

    // The child's own field wins, props are shallow-merged over the parent's, and parts are replaced rather
    // than merged: a child that declares parts declares the whole part tree it has.
    private static Template OverParent(Template parent, TemplateDecl decl)
    {
        var fields = new Dictionary<string, FieldDecl>(parent.Fields ?? new Dictionary<string, FieldDecl>());
        foreach (var (name, field) in decl.Fields ?? new Dictionary<string, FieldDecl>())
        {
            fields[name] = field;
        }
        var props = parent.Props;
        foreach (var (name, value) in PropsOf(decl.Props ?? new Dictionary<string, JsonNode?>()))
        {
            props = props.With(name, value);
        }

        return new Template(
            Id: decl.Id,
            SizeCm: decl.SizeCm ?? parent.SizeCm,
            MassG: decl.MassG ?? parent.MassG,
            Parts: decl.Parts is not null ? CopyParts(decl.Parts) : OverriddenParts(parent.Parts, decl),
            Props: props,
            BreakProducts: decl.BreakProducts is not null ? CopyProducts(decl.BreakProducts) : parent.BreakProducts,
            BreakResidue: decl.BreakResidue is not null
                ? new Dictionary<string, long>(decl.BreakResidue)
                : parent.BreakResidue,
            SpentProducts: NonEmptyProducts(decl.SpentProducts ?? parent.SpentProducts),
            SpentResidue: NonEmptyResidue(decl.SpentResidue ?? parent.SpentResidue),
            Lineage: [parent.Id, .. parent.Lineage ?? Array.Empty<string>()],
            Catalog: decl.Catalog == false ? false : null,
            MaxIntegrity: decl.MaxIntegrity ?? parent.MaxIntegrity,
            Processes: NonEmptyProcesses(MergeProcesses(parent.Processes ?? [], decl.Processes ?? [])),
            Fields: NonEmptyFields(fields));
    }

    // The parent's parts with a child's `part_overrides` merged onto the part of each name. A name the parent
    // has no part of is refused.
    private static IReadOnlyList<PartDecl> OverriddenParts(IReadOnlyList<PartDecl> parts, TemplateDecl decl)
    {
        var overrides = decl.PartOverrides;
        if (overrides is null)
        {
            return parts;
        }
        foreach (var name in overrides.Keys)
        {
            if (!parts.Any(part => part.Name == name))
            {
                throw new FormatException($"{decl.Id} part_overrides names {name}, which it inherits no part of");
            }
        }
        return [.. parts.Select(part =>
        {
            var found = overrides.TryGetValue(part.Name, out var over);
            return new PartDecl(
                Name: part.Name,
                Parent: found && over!.Parent.ValueKind is not JsonValueKind.Undefined
                    ? over.Parent.ValueKind is JsonValueKind.String ? over.Parent.GetString() : null
                    : part.Parent,
                Contributes: found && over!.Contributes is not null
                    ? new Dictionary<string, long>(over.Contributes)
                    : new Dictionary<string, long>(part.Contributes),
                Detachable: found && over!.Detachable is { } detachable ? detachable : part.Detachable,
                MaxIntegrity: found && over!.MaxIntegrity is { } maxIntegrity ? maxIntegrity : part.MaxIntegrity,
                Holds: found && over!.Holds is not null ? over.Holds : part.Holds);
        })];
    }

    // Processes merge by id like props: the parent's list, each replaced by a child's of the same id, then the
    // child's new ones in the order it declares them.
    private static List<ProcessDecl> MergeProcesses(IReadOnlyList<ProcessDecl> parent, IReadOnlyList<ProcessDecl> own)
    {
        var replaced = new Dictionary<string, ProcessDecl>();
        foreach (var decl in own)
        {
            replaced[decl.Id] = decl;
        }
        var merged = parent.Select(decl => replaced.GetValueOrDefault(decl.Id) ?? decl).ToList();
        var inherited = new HashSet<string>(parent.Select(decl => decl.Id));
        merged.AddRange(own.Where(decl => !inherited.Contains(decl.Id)));
        return merged;
    }

    private static List<PartDecl> CopyParts(IReadOnlyList<PartDecl> parts) =>
        [.. parts.Select(part => part with
        {
            Contributes = new Dictionary<string, long>(part.Contributes),
        })];

    // A declaration's props as values: a null one is no prop.
    private static Value.Map PropsOf(IReadOnlyDictionary<string, JsonNode?> props) =>
        Value.Of(props.Select(pair => KeyValuePair.Create(pair.Key, ValueJson.FromNode(pair.Value))));

    private static List<Product> CopyProducts(IReadOnlyList<Product> products) => [.. products];

    private static List<Product>? NonEmptyProducts(IReadOnlyList<Product>? products) =>
        products is { Count: > 0 } ? CopyProducts(products) : null;

    private static Dictionary<string, long>? NonEmptyResidue(IReadOnlyDictionary<string, long>? residue) =>
        residue is { Count: > 0 } ? new Dictionary<string, long>(residue) : null;

    private static List<ProcessDecl>? NonEmptyProcesses(IReadOnlyList<ProcessDecl>? processes) =>
        processes is { Count: > 0 } ? [.. processes] : null;

    private static Dictionary<string, FieldDecl>? NonEmptyFields(IReadOnlyDictionary<string, FieldDecl>? fields) =>
        fields is { Count: > 0 } ? new Dictionary<string, FieldDecl>(fields) : null;
}
