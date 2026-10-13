using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// A template's process as the engine runs it (src/templates.ts ProcessDecl). The loader keeps a process's body as JSON so the
// template hash and the frozen templates stay as they were; this reads that body when a process runs. Unknown members are
// refused, as the loader would refuse them.
public sealed record ProcessSpec(
    string Id,
    long EveryTicks,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? EveryTicksProp,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ProcessWhile? While,
    ProcessEffect Effect,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? ChancePct,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ProcessThen? Then)
{
    private static readonly ConditionalWeakTable<ProcessDecl, ProcessSpec> Parsed = new();

    public static ProcessSpec From(ProcessDecl decl) => Parsed.GetValue(decl, Parse);

    private static ProcessSpec Parse(ProcessDecl decl)
    {
        var body = System.Text.Json.JsonSerializer.SerializeToNode(decl.Body, WorldJson.Options) as JsonObject ?? new JsonObject();
        body["id"] = decl.Id;
        return WorldJson.Read<ProcessSpec>(body.ToJsonString());
    }
}

// The condition a process runs under: a prop, a comparison, and the value compared with.
public sealed record ProcessWhile(string Prop, string Op, JsonNode? Value);

// What a run does to the entity: one prop moved by `by`, clamped to its bounds.
public sealed record ProcessEffect(ProcessAdjust AdjustProp);

public sealed record ProcessAdjust(
    string Prop,
    long By,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Min = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Max = null);

// What a process does once, on reaching its bound. Exactly one of the forms is given; `remove` is named so a template that
// uses it parses, and is refused when it runs.
public sealed record ProcessThen(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ProcessSetProp? SetProp = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ProcessDamage? Damage = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? Spent = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonNode? Remove = null);

public sealed record ProcessSetProp(string Prop, JsonNode? Value);

public sealed record ProcessDamage(long Amount);
