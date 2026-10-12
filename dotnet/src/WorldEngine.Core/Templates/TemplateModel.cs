using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorldEngine.Core.Templates;

// What a template file declares (TemplateDecl) and what a resolved set holds (Template), as in
// src/templates.ts. Processes keep their body as JSON until the processes are ported; resolution only
// reads their id.

public sealed record Dimensions(long W, long D, long H);

public sealed record Holds(
    string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? InnerWCm = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? InnerDCm = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? InnerHCm = null);

public sealed record PartDecl(
    string Name,
    string? Parent,
    IReadOnlyDictionary<string, long> Contributes,
    bool Detachable,
    long MaxIntegrity,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Holds? Holds = null);

// What a child may change of an inherited part: any field but its name. `parent` is not accepted here yet,
// so an override naming it is refused rather than applied wrongly.
public sealed record PartOverride(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? MaxIntegrity = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Detachable = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, long>? Contributes = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Holds? Holds = null);

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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<Product>? SpentProducts = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, long>? SpentResidue = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Lineage = null,
    // Only `false`, and never inherited: a child of a catalog-hidden base is offered.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Catalog = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? MaxIntegrity = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<ProcessDecl>? Processes = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, FieldDecl>? Fields = null);

// The declarations of one set, with where each came from (a file name, for the messages that name it).
public sealed record DeclaredSet(
    IReadOnlyDictionary<string, TemplateDecl> Decls,
    IReadOnlyDictionary<string, string> Sources);
