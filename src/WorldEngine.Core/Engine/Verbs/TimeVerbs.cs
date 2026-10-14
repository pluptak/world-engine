using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The verbs that are only time (src/engine/verbs/wait.ts). `advance` is the world author's: time with no one acting. Its
// `stop_on_perceived` agents end the time early at the first tick one of them could sense something. Its `stop_before`
// beat ends it one tick short of that beat's tick, while the beat is pending there.
public static class TimeVerbs
{
    public static Pipeline.VerbDecl Advance { get; } = new(
        RequiresTarget: false,
        AuthorOnly: true,
        Preconditions: AdvancePreconditions,
        Duration: VerbDuration.FromArg("ticks"),
        WakeOn: command => Listed(command) ?? [],
        StopBefore: StopBeatOf);

    // The beat `stop_before` names, as it is pending in the snapshot the command is decided against, or null.
    private static Clock.StopBeat? StopBeatOf(Command command, Snapshot snapshot)
    {
        if (command.Args is null || !command.Args.TryGetValue("stop_before", out var node) || node is not JsonValue value
            || !value.TryGetValue(out string? id))
        {
            return null;
        }
        var cause = Schedule.Pending(snapshot).FirstOrDefault(entry => entry.Kind == CauseKind.Beat && entry.Id == id);
        return cause is null ? null : new Clock.StopBeat(id, cause.DueTick);
    }

    // The `ticks` arg as a positive safe integer, or null when it is not one (src/engine/clock.ts `commandDuration`).
    public static long? Ticks(Command command) => VerbDuration.ArgTicks(command, "ticks");

    // The agents `stop_on_perceived` names: none when the argument is absent, else a non-empty list of ids, or null when
    // the argument is malformed.
    private static IReadOnlyList<string>? Listed(Command command)
    {
        if (command.Args is null || !command.Args.TryGetValue("stop_on_perceived", out var node))
        {
            return [];
        }
        if (node is not JsonArray array || array.Count == 0)
        {
            return null;
        }
        var ids = new List<string>(array.Count);
        foreach (var element in array)
        {
            if (element is not JsonValue value || !value.TryGetValue(out string? id) || id.Length == 0)
            {
                return null;
            }
            ids.Add(id);
        }
        return ids;
    }

    private static Pipeline.Refusal? AdvancePreconditions(Pipeline.CommandContext context)
    {
        var command = context.Command;
        if (command.Actor != Resolve.WorldAuthor)
        {
            return Pipeline.Invalid(Code.InvalidAuthor);
        }
        if (Ticks(command) is null)
        {
            return Pipeline.Invalid(Code.InvalidArgs);
        }
        if (Listed(command) is not { } ids)
        {
            return Pipeline.Invalid(Code.InvalidArgs);
        }
        foreach (var id in ids)
        {
            // A body destroyed is still there, but no longer an agent: the code says which.
            if (!context.Snapshot.Entities.TryGetValue(id, out var watcher) || !Reach.IsAgent(context.Snapshot, id))
            {
                return new Pipeline.Refusal(
                    Status.Invalid,
                    watcher?.Status == EntityStatus.Destroyed ? Code.ObserverDestroyed : Code.NoSuchActor);
            }
        }
        if (command.Args is not null && command.Args.TryGetValue("stop_before", out var stop))
        {
            if (stop is not JsonValue value || !value.TryGetValue(out string? id) || !Beats.IsBeatId(id))
            {
                return Pipeline.Invalid(Code.InvalidArgs);
            }
            var cause = Schedule.Pending(context.Snapshot).FirstOrDefault(entry => entry.Kind == CauseKind.Beat && entry.Id == id);
            if (cause is null)
            {
                return Pipeline.Refused(Code.NoSuchBeat);
            }
            // The beat falls due at the very next tick: there is no time to run up to it, so nothing passes.
            if (cause.DueTick <= context.Snapshot.Tick + 1)
            {
                return Pipeline.Refused(Code.BeatNotAhead);
            }
        }
        return null;
    }
}
