using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Templates;

// What a template file declares (TemplateDecl) and what a resolved set holds (Template), as in
// src/templates.ts. Processes keep their body as JSON until the processes are ported; resolution only
// reads their id.

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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Parent,
    IReadOnlyDictionary<string, long> Contributes,
    bool Detachable,
    long MaxIntegrity,
    Holds? Holds = null);

// What a child may change of an inherited part: any field but its name. A parent override is a
// JsonElement so an absent parent inherits, an explicit null reparents to the root, and a string
// renames it (System.Text.Json leaves a missing struct property default, whose ValueKind is
// Undefined); anything else is refused where declarations are checked.
public sealed record PartOverride(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] JsonElement Parent = default,
    long? MaxIntegrity = null,
    bool? Detachable = null,
    IReadOnlyDictionary<string, long>? Contributes = null,
    Holds? Holds = null);

public sealed record Product(string Template, long Count);

public sealed record FieldDecl(string Tier, string Type);

public sealed record ProcessDecl(string Id)
{
    [JsonExtensionData]
    public Dictionary<string, JsonElement> Body { get; init; } = new();
}

// A template file before its parent is folded in: every field but `id` may be absent.
public sealed record TemplateDecl(
    string Id,
    string? Extends = null,
    Dimensions? SizeCm = null,
    long? MassG = null,
    IReadOnlyList<PartDecl>? Parts = null,
    IReadOnlyDictionary<string, PartOverride>? PartOverrides = null,
    IReadOnlyDictionary<string, JsonNode?>? Props = null,
    IReadOnlyList<Product>? BreakProducts = null,
    IReadOnlyDictionary<string, long>? BreakResidue = null,
    IReadOnlyList<Product>? SpentProducts = null,
    IReadOnlyDictionary<string, long>? SpentResidue = null,
    IReadOnlyList<ProcessDecl>? Processes = null,
    IReadOnlyDictionary<string, FieldDecl>? Fields = null,
    IReadOnlyList<string>? Lineage = null,
    bool? Catalog = null,
    long? MaxIntegrity = null);

// A resolved template: no `extends` left, every field present or absent by the rules of src/templates.ts.
public sealed record Template(
    string Id,
    Dimensions SizeCm,
    long MassG,
    IReadOnlyList<PartDecl> Parts,
    IReadOnlyDictionary<string, JsonNode?> Props,
    IReadOnlyList<Product> BreakProducts,
    IReadOnlyDictionary<string, long> BreakResidue,
    IReadOnlyList<Product>? SpentProducts = null,
    IReadOnlyDictionary<string, long>? SpentResidue = null,
    IReadOnlyList<string>? Lineage = null,
    // Only `false`, and never inherited: a child of a catalog-hidden base is offered.
    bool? Catalog = null,
    long? MaxIntegrity = null,
    IReadOnlyList<ProcessDecl>? Processes = null,
    IReadOnlyDictionary<string, FieldDecl>? Fields = null);

// The declarations of one set, with where each came from (a file name, for the messages that name it).
public sealed record DeclaredSet(
    IReadOnlyDictionary<string, TemplateDecl> Decls,
    IReadOnlyDictionary<string, string> Sources);
