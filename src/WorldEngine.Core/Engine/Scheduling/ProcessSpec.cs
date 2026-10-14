using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// A template's process as the engine runs it (src/templates.ts ProcessDecl). The loader keeps a process's body as JSON so the
// template hash and the frozen templates stay as they were; this reads that body when a process runs. Unknown members are
// refused, as the loader would refuse them.
public sealed record ProcessSpec(
    string Id,
    long EveryTicks,
    string? EveryTicksProp,
    ProcessWhile? While,
    ProcessEffect Effect,
    long? ChancePct,
    ProcessThen? Then)
{
    private static readonly ConditionalWeakTable<ProcessDecl, ProcessSpec> Parsed = new();

    public static ProcessSpec From(ProcessDecl decl) => Parsed.GetValue(decl, Parse);

    private static ProcessSpec Parse(ProcessDecl decl)
    {
        var body = System.Text.Json.JsonSerializer.SerializeToNode(decl.Body, WorldJson.Options) as JsonObject ?? new JsonObject();
        body["id"] = decl.Id;
        return WorldJson.Read<ProcessSpec>(body);
    }
}

// The condition a process runs under: a prop, a comparison, and the value compared with.
public sealed record ProcessWhile(string Prop, string Op, JsonNode? Value);

// What a run does to the entity: one prop moved by `by`, clamped to its bounds.
public sealed record ProcessEffect(ProcessAdjust AdjustProp);

public sealed record ProcessAdjust(
    string Prop,
    long By,
    long? Min = null,
    long? Max = null);

// What a process does once, on reaching its bound. Exactly one of the forms is given; `remove` is named so a template that
// uses it parses, and is refused when it runs.
public sealed record ProcessThen(
    ProcessSetProp? SetProp = null,
    ProcessDamage? Damage = null,
    bool? Spent = null,
    JsonNode? Remove = null);

public sealed record ProcessSetProp(string Prop, JsonNode? Value);

public sealed record ProcessDamage(long Amount);
