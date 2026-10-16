using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Templates;

// What a template file declares (TemplateDecl) and what a resolved set holds (Template), as in
// src/templates.ts.

public sealed record Dimensions(long W, long D, long H);

public enum HoldKind
{
    Grip,
    Space,
}

public sealed record Holds(
    HoldKind Kind,
    long? InnerWCm = null,
    long? InnerDCm = null,
    long? InnerHCm = null);

public sealed record PartDecl(
    string Name,
    string? Parent,
    IReadOnlyDictionary<string, long> Contributes,
    bool Detachable,
    long MaxIntegrity,
    Holds? Holds = null);

// What a child may change of an inherited part: any field but its name. An absent parent inherits, an empty one moves the part
// to the root, and any other names its new parent.
public sealed record PartOverride(
    string? Parent = null,
    long? MaxIntegrity = null,
    bool? Detachable = null,
    IReadOnlyDictionary<string, long>? Contributes = null,
    Holds? Holds = null);

public sealed record Product(string Template, long Count);

public sealed record FieldDecl(string Tier, string Type);

// A template file before its parent is folded in: every field but `id` may be absent.
public sealed record TemplateDecl(
    string Id,
    string? Extends = null,
    Dimensions? SizeCm = null,
    long? MassG = null,
    IReadOnlyList<PartDecl>? Parts = null,
    IReadOnlyDictionary<string, PartOverride>? PartOverrides = null,
    Value.Map? Props = null,
    IReadOnlyList<Product>? BreakProducts = null,
    IReadOnlyDictionary<string, long>? BreakResidue = null,
    IReadOnlyList<Product>? SpentProducts = null,
    IReadOnlyDictionary<string, long>? SpentResidue = null,
    IReadOnlyList<ProcessSpec>? Processes = null,
    IReadOnlyDictionary<string, FieldDecl>? Fields = null,
    IReadOnlyList<string>? Lineage = null,
    bool? Catalog = null,
    long? MaxIntegrity = null,
    // The companion template this one stands in for (`human.arm_l`), when it is installable (`docs/sockets.md`).
    string? Fits = null);

// A resolved template: no `extends` left, every field present or absent by the rules of src/templates.ts.
public sealed record Template(
    string Id,
    Dimensions SizeCm,
    long MassG,
    IReadOnlyList<PartDecl> Parts,
    Value.Map Props,
    IReadOnlyList<Product> BreakProducts,
    IReadOnlyDictionary<string, long> BreakResidue,
    IReadOnlyList<Product>? SpentProducts = null,
    IReadOnlyDictionary<string, long>? SpentResidue = null,
    IReadOnlyList<string>? Lineage = null,
    // Only `false`, and never inherited: a child of a catalog-hidden base is offered.
    bool? Catalog = null,
    long? MaxIntegrity = null,
    IReadOnlyList<ProcessSpec>? Processes = null,
    IReadOnlyDictionary<string, FieldDecl>? Fields = null,
    // The companion template this one stands in for, resolved with the set (`docs/sockets.md`).
    string? Fits = null);

// The declarations of one set, with where each came from (a file name, for the messages that name it).
public sealed record DeclaredSet(
    IReadOnlyDictionary<string, TemplateDecl> Decls,
    IReadOnlyDictionary<string, string> Sources);
