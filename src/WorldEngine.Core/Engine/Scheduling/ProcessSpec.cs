using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A template's process (src/templates.ts ProcessDecl): every so many ticks, while its condition holds, one prop moved toward a
// bound, and what it does once on reaching it. `TemplateShape` holds a declaration to these fields before it is read.
public sealed record ProcessSpec(
    string Id,
    long EveryTicks,
    ProcessEffect Effect,
    string? EveryTicksProp = null,
    ProcessWhile? While = null,
    long? ChancePct = null,
    ProcessThen? Then = null);

// The condition a process runs under: a prop, a comparison, and the value compared with.
public sealed record ProcessWhile(string Prop, string Op, Value? Value);

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
    bool? Remove = null);

public sealed record ProcessSetProp(string Prop, Value? Value);

public sealed record ProcessDamage(long Amount);
