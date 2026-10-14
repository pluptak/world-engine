using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Running a due beat: its condition, its action, its followers and its next repeat.
public static partial class Beats
{

    // A watch (a repeating beat with `until_ran`) records nothing while its condition is false, and ends after the first run
    // whose action ran; a failed run is still recorded and the watch goes on (src/engine/beats.ts `runBeat`).
    public static void Run(Working working, IReadOnlyDictionary<string, Template> registry, BeatCause cause)
    {
        var watch = cause.Repeat is { UntilRan: true };
        if (cause.OnlyIf is { } onlyIf && !Holds(onlyIf, working.Snapshot))
        {
            if (!watch)
            {
                Skipped(working, cause, ("reason", "condition"));
            }
        }
        else
        {
            switch (Fire(working, registry, cause))
            {
                case Failed failed:
                    Skipped(working, cause, ("reason", "failed"), ("code", failed.Code));
                    break;
                case Done done:
                    ScheduleFollowers(working, cause.Then, done.EventId);
                    if (watch)
                    {
                        return;
                    }
                    break;
            }
        }
        ScheduleNextRun(working, cause);
    }

    private static void Skipped(Working working, BeatCause cause, params (string Key, string Value)[] data)
    {
        var fields = new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["id"] = JsonValue.Create(cause.Id) };
        foreach (var (key, value) in data)
        {
            fields[key] = JsonValue.Create(value);
        }
        working.Emit(EventType.BeatSkipped, cause.Entity, fields, cause.CauseId);
    }

    private static Fired Fire(Working working, IReadOnlyDictionary<string, Template> registry, BeatCause cause)
    {
        var action = cause.Action;
        if (JsonReads.Text(action["kind"]) == "sound")
        {
            var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["loud"] = JsonValue.Create(JsonReads.IsTrue(action["loud"])) };
            return new Done(working.Emit(EventType.Sounded, JsonReads.Text(action["entity"])!, data, cause.CauseId));
        }
        return FireEdit(working, registry, cause, action);
    }

    // An edit runs under the beat's own cause, as the author's `edit` would, with the verb's own checks; a failure puts back
    // everything it wrote (the snapshot, the events and the deltas), and the snapshot-wide guard runs after it.
    private static Fired FireEdit(Working working, IReadOnlyDictionary<string, Template> registry, BeatCause cause, JsonObject action)
    {
        var targetText = JsonReads.Text(action["target"]);
        Resolve.TargetAddress? target = null;
        if (targetText is not null)
        {
            var resolution = Resolve.ResolveTarget(working.Snapshot, registry, Resolve.WorldAuthor, targetText);
            if (resolution is not Resolve.Resolved resolved)
            {
                return new Failed(resolution is Resolve.Ambiguous ? "ambiguous" : "unresolved");
            }
            target = resolved.Target;
        }
        var command = new Command(
            working.CommandId,
            Resolve.WorldAuthor,
            "edit",
            targetText,
            new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["edit"] = action.DeepClone() });
        var context = new Pipeline.CommandContext(working.Snapshot, registry, command, target, EditVerb.Edit.Requires ?? []);
        if (EditVerb.Edit.Preconditions?.Invoke(context) is { } refused)
        {
            return new Failed(CodeOf(refused));
        }

        var mark = working.Mark();
        EditVerb.Edit.Transition?.Invoke(working, context, cause.CauseId);
        // The removal of a subject takes its other pending causes with it before the result is checked, as it does for an
        // edit the author sends.
        Schedule.Prune(working);
        if (EditVerb.Edit.ValidateResult?.Invoke(context with { Snapshot = working.Snapshot }) is { } guard)
        {
            working.Rollback(mark);
            return new Failed(CodeOf(guard));
        }
        return new Done(working.Events.Count > mark.Events ? working.Events[mark.Events].EventId : cause.CauseId);
    }

    private static string CodeOf(Pipeline.Refusal refusal) => Pipeline.ReasonName(refusal.ReasonCode, refusal.Status);

    // Each follower is scheduled `delay_ticks` after its parent ran, with the parent's event as its cause. One whose subject is
    // gone, or whose due tick is out of range, is not scheduled.
    private static void ScheduleFollowers(Working working, IReadOnlyList<BeatFollower>? children, string? parentEvent)
    {
        foreach (var child in children ?? [])
        {
            var subject = ActionSubject(child.Action);
            if (subject is null || !working.Snapshot.Entities.ContainsKey(subject)
                || !TryAdd(working.Snapshot.Tick, child.DelayTicks, out var due))
            {
                continue;
            }
            Schedule.Add(working, new BeatCause(due, subject, parentEvent, child.Id, child.Action, child.OnlyIf, child.Then));
        }
    }

    // The next run of a repeating beat, whatever this one did: it ran, was skipped by its condition, or was refused. It keeps the
    // id, and the cause of the run before it; the run after the last carries no repeat.
    private static void ScheduleNextRun(Working working, BeatCause cause)
    {
        if (cause.Repeat is not { } repeat)
        {
            return;
        }
        if (!working.Snapshot.Entities.ContainsKey(cause.Entity) || !TryAdd(working.Snapshot.Tick, repeat.EveryTicks, out var due))
        {
            return;
        }
        var next = cause with
        {
            DueTick = due,
            Repeat = repeat.Times > 1 ? repeat with { Times = repeat.Times - 1 } : null,
        };
        Schedule.Add(working, next);
    }
}
