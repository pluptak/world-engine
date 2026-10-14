using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Processes (src/engine/process.ts): a template's runs that move an entity's props on a schedule, each run scheduled from the
// one before it. A process that can run has one pending; one that cannot is withdrawn. Reconciled wherever props can change.
public static class Processes
{
    private static IReadOnlyList<ProcessSpec> DeclsOf(IReadOnlyDictionary<string, Template> registry, Entity entity)
    {
        if (!registry.TryGetValue(entity.Template, out var template) || template.Processes is null)
        {
            return [];
        }
        return [.. template.Processes.Select(ProcessSpec.From)];
    }

    // Whether a number read from a prop is whole; false when the prop is no number.
    private static bool IsInt(double? value) =>
        value is { } number && IsWhole(number);

    // The condition under which a process runs, read from the entity's props as they are now. `eq` and `ne` compare any
    // primitive strictly; the ordering ops need numbers on both sides, and an absent or non-numeric prop satisfies none.
    private static bool WhileHolds(ProcessSpec spec, IReadOnlyDictionary<string, JsonNode?> props)
    {
        if (spec.While is not { } condition)
        {
            return true;
        }
        var actual = props.GetValueOrDefault(condition.Prop);
        if (condition.Op == "eq")
        {
            return Prop.SameValue(actual, condition.Value);
        }
        if (condition.Op == "ne")
        {
            return !Prop.SameValue(actual, condition.Value);
        }
        if (condition.Op is not ("lt" or "lte" or "gt" or "gte"))
        {
            throw new InvalidOperationException($"Unknown while op {condition.Op}");
        }
        return JsonReads.Number(actual) is { } have
            && JsonReads.Number(condition.Value) is { } want
            && OrderOps.Holds(condition.Op, have, want);
    }

    // A process can run when its condition holds and the prop it adjusts is an integer not yet at the bound it is moving
    // toward, on something not destroyed. A prop at its bound is where the process ends, not something to poll.
    private static bool Runnable(ProcessSpec spec, Entity entity)
    {
        var adjust = spec.Effect.AdjustProp;
        var value = JsonReads.Number(entity.Props.GetValueOrDefault(adjust.Prop));
        if (entity.Status == EntityStatus.Destroyed || !IsInt(value) || !WhileHolds(spec, entity.Props))
        {
            return false;
        }
        var current = (long)value!.Value;
        if (adjust.By < 0 && adjust.Min is { } min && current <= min)
        {
            return false;
        }
        if (adjust.By > 0 && adjust.Max is { } max && current >= max)
        {
            return false;
        }
        return true;
    }

    // How long the next run waits: the prop named by `every_ticks_prop` when it is a positive integer, else `every_ticks`. Read
    // when the run is scheduled, so a run already pending keeps the delay it was given.
    private static long DelayOf(ProcessSpec spec, Entity entity)
    {
        var rate = spec.EveryTicksProp is { } prop ? JsonReads.Number(entity.Props.GetValueOrDefault(prop)) : null;
        return IsInt(rate) && rate >= 1 ? (long)rate!.Value : spec.EveryTicks;
    }

    private static bool IsPendingFor(ScheduledCause cause, string entity, string process) =>
        cause is ProcessCause running && running.Entity == entity && running.Process == process;

    // Brings one entity's schedule in line with its props: a process that can run and has nothing pending is scheduled
    // `every_ticks` from now, naming the event that made it so; a pending one that can no longer run is withdrawn, recording
    // nothing. Called wherever props can change, never on a timer.
    public static void Reconcile(Working working, IReadOnlyDictionary<string, Template> registry, string entityId, string? causeId)
    {
        var snapshot = working.Snapshot;
        if (!snapshot.Entities.TryGetValue(entityId, out var entity))
        {
            return;
        }
        ReconcileClose(working, entity, causeId);
        foreach (var spec in DeclsOf(registry, entity))
        {
            var waiting = Schedule.Pending(working.Snapshot).Any(cause => IsPendingFor(cause, entityId, spec.Id));
            var can = Runnable(spec, entity);
            if (can && !waiting)
            {
                if (TryAdd(snapshot.Tick, DelayOf(spec, entity), out var due))
                {
                    Schedule.Add(working, new ProcessCause(due, entityId, causeId, spec.Id));
                }
            }
            else if (!can && waiting)
            {
                Schedule.Replace(
                    working,
                    [.. Schedule.Pending(working.Snapshot).Where(cause => !IsPendingFor(cause, entityId, spec.Id))]);
            }
        }
    }

    // A self-closing openable that is open, however it came to be, closes `closes_after` ticks from now: placed open, spawned,
    // edited or refined into one. The `open` verb schedules its own first, so one already pending is left as it is.
    private static void ReconcileClose(Working working, Entity entity, string? causeId)
    {
        if (!entity.Props.Is(Prop.Openable)
            || !entity.Props.Is(Prop.Open)
            || entity.Props.Get(Prop.ClosesAfter) is not { } after
            || !IsInt(after)
            || after <= 0
            || Schedule.Pending(working.Snapshot).Any(cause => cause.Kind == CauseKind.Close && cause.Entity == entity.Id))
        {
            return;
        }
        if (TryAdd(working.Snapshot.Tick, (long)after, out var due))
        {
            Schedule.Add(working, new CloseCause(due, entity.Id, causeId));
        }
    }

    // A world built from a scenario has no event behind it, so what its templates set going starts with no cause.
    public static Snapshot StartProcesses(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry)
    {
        var working = new Working(snapshot, "start");
        foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            Reconcile(working, registry, id, null);
        }
        return working.Snapshot;
    }

    // After a stretch of a command's own changes (or after one cause has run), reconcile every entity whose props changed, that
    // was spawned or that became another preset in it, each naming the last event that touched it. A refinement may change no
    // prop, so its template is the only trace.
    public static void ReconcileSince(Working working, IReadOnlyDictionary<string, Template> registry, int mark)
    {
        var order = new List<string>();
        var touched = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var delta in working.Deltas.Skip(mark))
        {
            if (delta.To is not null && delta.Field is "props" or "entity" or "template")
            {
                if (!touched.ContainsKey(delta.Entity))
                {
                    order.Add(delta.Entity);
                }
                touched[delta.Entity] = delta.EventId;
            }
        }
        foreach (var entity in order)
        {
            Reconcile(working, registry, entity, touched[entity]);
        }
    }

    // One run: adjust the prop, clamped to its bounds, under a `changed` that names the event that set the process going. A
    // cause the world has overtaken does nothing. The next run is scheduled by the reconcile that follows the write, so a
    // process that reached its bound is not scheduled again.
    public static void RunProcess(Working working, IReadOnlyDictionary<string, Template> registry, ProcessCause cause)
    {
        if (!working.Snapshot.Entities.TryGetValue(cause.Entity, out var entity))
        {
            return;
        }
        var spec = DeclsOf(registry, entity).FirstOrDefault(decl => decl.Id == cause.Process);
        if (spec is null || !Runnable(spec, entity))
        {
            return;
        }
        // A chance process rolls each run: a miss does nothing and says nothing, and the next run is scheduled as though this
        // one had happened, since no write will do it.
        if (spec.ChancePct is { } chance && working.Random() * 100 >= chance)
        {
            Reconcile(working, registry, entity.Id, cause.CauseId);
            return;
        }
        var adjust = spec.Effect.AdjustProp;
        var from = (long)JsonReads.Number(entity.Props[adjust.Prop])!.Value;
        var moved = from + adjust.By;
        var to = adjust.By < 0
            ? Math.Max(moved, adjust.Min ?? long.MinValue)
            : Math.Min(moved, adjust.Max ?? long.MaxValue);
        if (to == from)
        {
            return;
        }
        var eventId = working.Emit(
            EventType.Changed,
            entity.Id,
            Pipeline.Reason(("prop", adjust.Prop), ("from", from), ("to", to), ("process", spec.Id)),
            cause.CauseId);
        var props = new Dictionary<string, JsonNode?>(entity.Props, StringComparer.Ordinal) { [adjust.Prop] = JsonValue.Create(to) };
        working.SetProps(entity.Id, props, eventId);
        var reached = adjust.By < 0 ? adjust.Min == to : adjust.Max == to;
        if (reached && spec.Then is { } then)
        {
            RunThen(working, registry, entity.Id, spec, then, eventId);
        }
    }

    // What a process does once, on reaching its bound, under the `changed` that reached it: write a prop (a second `changed`),
    // take integrity (the same chain a bleed makes), take the entity out of the world, or use it up (`spent`). Each can
    // start or stop other processes through the reconcile that follows.
    private static void RunThen(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string entityId,
        ProcessSpec spec,
        ProcessThen then,
        string causeId)
    {
        if (!working.Snapshot.Entities.TryGetValue(entityId, out var entity))
        {
            return;
        }
        if (then.SetProp is { } set)
        {
            var current = entity.Props.GetValueOrDefault(set.Prop);
            if (!Prop.SameValue(current, set.Value))
            {
                var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
                {
                    ["prop"] = JsonValue.Create(set.Prop),
                    ["from"] = current?.DeepClone(),
                    ["to"] = set.Value?.DeepClone(),
                    ["process"] = JsonValue.Create(spec.Id),
                };
                var eventId = working.Emit(EventType.Changed, entityId, data, causeId);
                var props = new Dictionary<string, JsonNode?>(entity.Props, StringComparer.Ordinal) { [set.Prop] = set.Value?.DeepClone() };
                working.SetProps(entityId, props, eventId);
            }
        }
        else if (then.Damage is { } damage)
        {
            Harm.Apply(working, registry, entityId, damage.Amount, causeId);
        }
        else if (then.Spent == true)
        {
            Physical.SpendEntity(working, registry, entityId, causeId);
        }
        else
        {
            Physical.RemoveEntity(working, registry, entityId, causeId);
        }
    }
}
