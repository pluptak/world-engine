namespace WorldEngine.Core.Model;

// A beat's condition, in one of four forms told apart by which fields it has: `all` (single conditions that each must hold),
// `entity` and `in` (the entity is in that room), `room` and `occupied` (a live agent is there, or none), or `entity`, `prop`,
// `op` and `value` (the prop compared). `Beats` holds a condition to exactly one form wherever a beat is made or read.
public sealed record BeatCondition(
    IReadOnlyList<BeatCondition>? All = null,
    string? Entity = null,
    string? In = null,
    string? Room = null,
    bool? Occupied = null,
    string? Prop = null,
    string? Op = null,
    Value? Value = null);

// A beat that runs again every so many ticks, so many times after the first; a watch (`until_ran`) stops after the first run
// whose action ran.
public sealed record BeatRepeat(
    long EveryTicks,
    long Times,
    bool? UntilRan = null);

// A beat a beat schedules when it has run, `delay_ticks` later, with followers of its own.
public sealed record BeatFollower(
    string Id,
    long DelayTicks,
    Value.Map Action,
    BeatCondition? OnlyIf = null,
    IReadOnlyList<BeatFollower>? Then = null);

// A beat a scene keeps in its run's pool, with no tick until the director plays it.
public sealed record PoolBeat(
    string Id,
    Value.Map Action,
    BeatCondition? OnlyIf = null,
    IReadOnlyList<BeatFollower>? Then = null,
    BeatRepeat? Repeat = null);
