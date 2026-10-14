using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What each kind of edit does once it is accepted (src/engine/verbs/edit.ts `transition`).
public static partial class EditVerb
{
    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var edit = Parse(context.Command.Args) ?? throw new InvalidOperationException("Edit changed after validation");
        switch (edit)
        {
            case SpawnEdit spawn:
                var (_, location) = SpawnLocation(working.Snapshot, spawn);
                working.SpawnUnder(context.Registry, spawn.Template, spawn.Fields with { Location = location }, rootEventId);
                return;
            case SetSeedEdit seed:
                working.SetRng(seed.Seed);
                return;
            case RemoveEdit remove:
                if (!Physical.RemoveEntity(working, context.Registry, remove.Target, rootEventId))
                {
                    throw new InvalidOperationException("Edit subject changed after validation");
                }
                return;
            case PlaceEdit place:
                TransitionPlace(working, context, place, rootEventId);
                return;
            case PropsEdit props:
                TransitionProps(working, context, props, rootEventId);
                return;
            case SetPartEdit part:
                TransitionPart(working, context, part, rootEventId);
                return;
            case RefineEdit refine:
                TransitionRefine(working, context, refine, rootEventId);
                return;
            case ScheduleBeatEdit scheduled:
                // The beat is the `edit` event's to cause: what it does when due names that event.
                Schedule.Add(working, Beats.CauseOf(scheduled.Beat, rootEventId));
                return;
            case CancelBeatEdit cancelled:
                // Withdrawn at the source, recording nothing: the `edit` event is the record.
                Schedule.Replace(
                    working,
                    [.. Schedule.Pending(working.Snapshot).Where(cause => cause.Kind != CauseKind.Beat || cause.Id != cancelled.Id)]);
                return;
            case RetimeBeatEdit moved:
                TransitionRetime(working, moved);
                return;
            case StartRunEdit:
                Runs.StartRun(working);
                return;
            case EndRunEdit:
                Runs.EndRun(working, "director");
                return;
            case RegisterEdit register:
                Runs.RegisterPlayer(working, register.Handle, register.Slot);
                return;
            case PlayBeatEdit play:
                TransitionPlay(working, play, rootEventId);
                return;
            case SteerEdit steer:
                TransitionSteer(working, steer);
                return;
        }
    }

    // The pool beat leaves the pool and is queued at its tick, caused by this edit's event, as a `schedule_beat` is.
    private static void TransitionPlay(Working working, PlayBeatEdit edit, string? rootEventId)
    {
        var run = working.Snapshot.Run ?? throw new InvalidOperationException("Play without a run after validation");
        var pool = run.Pool ?? [];
        var beat = pool.FirstOrDefault(entry => PoolId(entry) == edit.Id)
            ?? throw new InvalidOperationException("Play changed after validation");
        working.SetRun(run with { Pool = [.. pool.Where(entry => PoolId(entry) != edit.Id)] });
        var queued = new JsonObject
        {
            ["at_tick"] = JsonValue.Create(edit.AtTick),
            ["id"] = beat["id"]!.DeepClone(),
            ["action"] = beat["action"]!.DeepClone(),
        };
        if (beat["only_if"] is { } onlyIf)
        {
            queued["only_if"] = onlyIf.DeepClone();
        }
        if (beat["then"] is { } then)
        {
            queued["then"] = then.DeepClone();
        }
        if (beat["repeat"] is { } repeat)
        {
            queued["repeat"] = repeat.DeepClone();
        }
        Schedule.Add(working, Beats.CauseOf(queued, rootEventId));
    }

    // The steered value takes the place of any earlier one for the same device and prop, and is in force from now.
    private static void TransitionSteer(Working working, SteerEdit edit)
    {
        var run = working.Snapshot.Run ?? throw new InvalidOperationException("Steer without a run after validation");
        var steered = (run.Steered ?? []).Where(entry => !(entry.Entity == edit.Entity && entry.Prop == Prop.JamPct)).ToList();
        steered.Add(new Steered(edit.Entity, Prop.JamPct, edit.Value));
        working.SetRun(run with { Steered = steered });
    }

    // The template changes, and the props and parts take what the new preset keeps of the entity's state. The subject is the
    // entity before the edit, so both are read from it, as src/engine/verbs/edit.ts does.
    // Taken off and put back at its new tick, so it runs after whatever is already due then, as if scheduled now.
    private static void TransitionRetime(Working working, RetimeBeatEdit edit)
    {
        var list = Schedule.Pending(working.Snapshot).ToList();
        var index = list.FindIndex(entry => entry.Kind == CauseKind.Beat && entry.Id == edit.Id);
        if (index < 0)
        {
            throw new InvalidOperationException("Edit changed after validation");
        }
        var cause = list[index];
        list.RemoveAt(index);
        Schedule.Replace(working, list);
        Schedule.Add(working, cause with { DueTick = edit.AtTick });
    }

    private static void TransitionRefine(Working working, Pipeline.CommandContext context, RefineEdit edit, string? rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        var next = context.Registry[edit.Template];
        var edited = working.Emit(
            EventType.Edited,
            edit.Target,
            Pipeline.Reason(("field", "template"), ("from", subject.Template), ("to", edit.Template)),
            rootEventId);
        working.SetTemplate(edit.Target, edit.Template, edited);
        working.SetProps(edit.Target, Refine.RefinedProps(subject, next), edited);
        working.SetParts(
            edit.Target,
            Refine.RefinedParts(subject, next) ?? throw new InvalidOperationException("Edit refinement changed after validation"),
            edited);
    }

    private static void TransitionPlace(Working working, Pipeline.CommandContext context, PlaceEdit edit, string? rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        edit = ResolveAnchor(context.Snapshot, edit, out var anchorRefusal);
        if (anchorRefusal is not null)
        {
            throw new InvalidOperationException("Edit placement changed after validation");
        }
        var placement = NormalizedPlacement(subject, edit) ?? throw new InvalidOperationException("Edit placement changed after validation");
        var placed = working.Emit(EventType.Placed, edit.Target, new Dictionary<string, JsonNode?>(), rootEventId);
        if (subject.Support is not null && placement.Support is null && placement.Contained is null)
        {
            Physical.PropagateSupportLoss(working, context.Registry, edit.Target, placed);
        }
        working.SetRelation(edit.Target, "contained_in", placement.Contained, placed);
        // A placement into a holder fills the first free grip unless the edit names one; a placement out of one clears
        // it; one that stays held keeps its grip.
        string? part;
        if (edit.InPart is { } named)
        {
            part = named.Value;
        }
        else if (edit.ContainedIn?.Value is { } holder)
        {
            part = Carry.ClaimGrip(working.Snapshot, context.Registry, holder, subject) is GripFound found ? found.Part : null;
        }
        else
        {
            part = placement.Contained is null ? null : subject.InPart;
        }
        working.SetRelation(edit.Target, "in_part", part, placed);
        working.SetRelation(edit.Target, "support", placement.Support, placed);
        working.SetPos(edit.Target, placement.Pos, placed);
        // A placement that changes where the entity is uncovers what it was hiding; an explicit `concealed_by` in the
        // same edit is written after that, so an author can hide a thing where they put it.
        if (placement.Support != subject.Support || placement.Contained != subject.ContainedIn || !SamePos(placement.Pos, subject.Pos))
        {
            Concealment.RevealConcealed(working, edit.Target, placed);
        }
        working.SetRelation(edit.Target, "concealed_by", edit.ConcealedBy is { } hidden ? hidden.Value : subject.ConcealedBy, placed);
        Placements.RefreshSubtreeLocations(working, edit.Target, placed);
    }

    private static bool SamePos(Pos? left, Pos? right) =>
        left is null || right is null ? left is null && right is null : left == right;

    private static void TransitionProps(Working working, Pipeline.CommandContext context, PropsEdit edit, string? rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        var edited = working.Emit(EventType.Edited, edit.Target, Pipeline.Reason(("field", "props")), rootEventId);
        IReadOnlyDictionary<string, JsonNode?> basis = edit.Kind == "update_props" ? subject.Props : new Dictionary<string, JsonNode?>();
        working.SetProps(edit.Target, Merge(basis, edit.Props), edited);
    }

    private static void TransitionPart(Working working, Pipeline.CommandContext context, SetPartEdit edit, string? rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        var edited = working.Emit(EventType.Edited, edit.Target, Pipeline.Reason(("field", "parts"), ("part", edit.Part)), rootEventId);
        var template = context.Registry[subject.Template];
        working.SetParts(
            edit.Target,
            PartStates.With(template, subject.Parts, new Dictionary<string, PartState> { [edit.Part] = edit.State }),
            edited);
        // Destroying a holder part spills what it held; a detached part is refused by validation, so only destruction
        // reaches here with contents still inside.
        foreach (var item in Carry.GripEvictions(working.Snapshot, context.Registry, edit.Target))
        {
            DropVerb.DropCarriedItem(working, context.Registry, edit.Target, item, edited);
        }
    }

}
