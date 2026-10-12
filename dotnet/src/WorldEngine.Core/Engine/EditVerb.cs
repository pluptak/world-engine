using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The world author's `edit` (src/engine/verbs/edit.ts): spawn, remove, place, set_props, update_props, set_part, set_seed,
// refine, the beat edits, and the run and role edits (start_run, end_run, register_player, play_beat, steer). The result is
// judged by the snapshot invariants, so an edit that would break one is refused and nothing is written.
public static class EditVerb
{
    public static Pipeline.VerbDecl Edit { get; } = new(
        RequiresTarget: false,
        AuthorOnly: true,
        Preconditions: Preconditions,
        Duration: _ => 0,
        Transition: Transition,
        ValidateResult: ValidateResult);

    // The refusal codes this verb may answer with (src/engine/verbs/edit.ts `refuses`). A validation code outside them is
    // a verb bug, which TypeScript throws on and so does this.
    private static readonly HashSet<string> Refuses =
    [
        "derived_field", "field_not_editable", "room_placed", "conflicting_placement", "room_support_without_pos",
        "pos_without_room_support", "anchor_not_room_supported", "circular_placement", "occupied_room", "unknown_part",
        "not_a_refinement", "too_large", "not_a_surface", "liquid_exceeds_capacity", "integrity_out_of_range",
        "detached_part_without_entity", "part_at_default", "part_under_detached", "coverage_not_computable",
        "location_mismatch", "dangling_reference", "id_not_below_next_seq", "support_or_containment_cycle",
        "support_and_contained_in", "door_side_not_room", "opens_target_not_openable", "concealed_by_abstract",
        "concealed_by_not_same_room", "concealed_by_cycle", "power_loop", "control_loop", "in_part_holder_mismatch",
        "in_part_unknown_part", "in_part_unavailable", "grip_occupied", "closing_without_close", "camera_without_facing",
        "part_contents_too_large", "container_contents_too_large", "invalid_trait", "beat_in_past", "duplicate_beat",
        "too_many_beats", "no_such_beat", "invalid_beat", "undeclared_prop", "wrong_prop_type", "unmet_requires", "no_run",
        "run_not_registering", "run_not_running", "no_such_slot", "slot_taken", "handle_taken", "role_forbidden",
        "no_such_pool_beat", "not_steerable", "out_of_range",
    ];

    private static readonly HashSet<string> OverrideKeys =
    [
        "name", "aliases", "location", "support", "contained_in", "in_part", "concealed_by", "pos", "detached_from",
        "integrity", "status", "residue", "modifiers", "props", "traits",
    ];

    // A field the edit names: Value is what it names, null for an explicit null (a clear). An absent field is no Given.
    private sealed record Given<T>(T? Value);

    private abstract record WorldEdit;
    // A spawn: the template, whether the location was named (Given, so an explicit null is kept apart from none), the
    // overrides as the spawn takes them, and whether any modifier was named (which is never allowed at a spawn).
    private sealed record SpawnEdit(string Template, Given<string>? Location, Spawn.Overrides Fields, bool HasModifiers) : WorldEdit;
    private sealed record SetSeedEdit(long Seed) : WorldEdit;
    private sealed record RemoveEdit(string Target) : WorldEdit;
    // A place: each relation as the edit names it (Given, so an explicit null is kept apart from none), and the position as
    // a plain position or as an offset from an anchor, which is resolved to a plain position before any rule reads it.
    private sealed record PlaceEdit(string Target, Given<string>? Support, Given<string>? ContainedIn, Given<string>? InPart, Given<string>? ConcealedBy, Given<Pos>? Pos, AnchorOffset? Anchor = null) : WorldEdit;
    private sealed record AnchorOffset(string Anchor, long Dx, long Dy);
    private sealed record RefineEdit(string Target, string Template) : WorldEdit;
    // The author's beat edits (src/engine/verbs/edit.ts): a beat to schedule, held as the edit's own JSON; a beat to cancel; and
    // a beat to move to another tick.
    private sealed record ScheduleBeatEdit(JsonObject Beat) : WorldEdit;
    private sealed record CancelBeatEdit(string Id) : WorldEdit;
    private sealed record RetimeBeatEdit(string Id, long AtTick) : WorldEdit;
    // The run and role edits (src/engine/verbs/edit.ts): a registration, a pool beat played at a tick, a door's odds steered,
    // and the run started or ended by the author or a director.
    private sealed record RegisterEdit(string Handle, string Slot) : WorldEdit;
    private sealed record PlayBeatEdit(string Id, long AtTick) : WorldEdit;
    private sealed record SteerEdit(string Entity, long Value) : WorldEdit;
    private sealed record StartRunEdit : WorldEdit;
    private sealed record EndRunEdit : WorldEdit;
    private sealed record PropsEdit(string Kind, string Target, IReadOnlyDictionary<string, JsonNode?> Props) : WorldEdit;
    private sealed record SetPartEdit(string Target, string Part, PartState State) : WorldEdit;

    private static Pipeline.Refusal Invalid(string code) => new(Status.Invalid, code);

    private static Pipeline.Refusal Refused(string code) => new(Status.Refused, code);

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var command = context.Command;
        if (command.Actor != Resolve.WorldAuthor)
        {
            return Invalid("invalid_author");
        }
        var edit = Parse(command.Args);
        if (edit is null)
        {
            return Invalid("invalid_args");
        }
        if (command.By is { } by && !RoleMay(by, edit))
        {
            return Refused("role_forbidden");
        }
        switch (edit)
        {
            case SpawnEdit spawn:
                return context.Target is not null ? Invalid("unexpected_target") : SpawnRefusal(context, spawn);
            case SetSeedEdit:
                return context.Target is null ? null : Invalid("unexpected_target");
            case StartRunEdit:
                return context.Target is null ? RunEditRefusal(context.Snapshot, start: true) : Invalid("unexpected_target");
            case EndRunEdit:
                return context.Target is null ? RunEditRefusal(context.Snapshot, start: false) : Invalid("unexpected_target");
            case RegisterEdit register:
                return context.Target is null ? RegisterRefusal(context.Snapshot, register) : Invalid("unexpected_target");
            case PlayBeatEdit play:
                return context.Target is null ? PlayRefusal(context.Snapshot, play) : Invalid("unexpected_target");
            case SteerEdit steer:
                return context.Target is null ? SteerRefusal(context.Snapshot, steer) : Invalid("unexpected_target");
        }
        // The beats name no target of their own: they are scheduled, cancelled or moved as a whole.
        if (edit is ScheduleBeatEdit or CancelBeatEdit or RetimeBeatEdit)
        {
            return context.Target is not null ? Invalid("unexpected_target") : BeatRefusal(context, edit);
        }
        var targetId = TargetOf(edit);
        if (context.Target is null || context.Target.Part is not null || context.Target.EntityId != targetId)
        {
            return Invalid("mismatched_target");
        }
        var subject = context.Snapshot.Entities[targetId];
        return edit switch
        {
            RemoveEdit => RemoveRefusal(context.Snapshot, subject),
            PlaceEdit place => PlaceRefusal(context, place, subject),
            PropsEdit props => PropsRefusal(context, subject, props),
            SetPartEdit part => PartRefusal(context.Registry, subject, part.Part),
            RefineEdit refine => context.Registry.TryGetValue(refine.Template, out var next)
                ? Refine.RefineRefusal(context.Snapshot, context.Registry, subject, next)
                : Invalid("unknown_template"),
            _ => throw new InvalidOperationException("Unknown edit"),
        };
    }

    private static string TargetOf(WorldEdit edit) => edit switch
    {
        RemoveEdit remove => remove.Target,
        PlaceEdit place => place.Target,
        PropsEdit props => props.Target,
        SetPartEdit part => part.Target,
        RefineEdit refine => refine.Target,
        _ => throw new InvalidOperationException("Edit has no target"),
    };

    private static Pipeline.Refusal? SpawnRefusal(Pipeline.CommandContext context, SpawnEdit edit)
    {
        var snapshot = context.Snapshot;
        var fields = edit.Fields;
        if (!context.Registry.TryGetValue(edit.Template, out var template))
        {
            return Invalid("unknown_template");
        }
        if (fields.Support is not null && fields.ContainedIn is not null)
        {
            return Refused("conflicting_placement");
        }
        if (Missing(snapshot, edit.Location?.Value) || Missing(snapshot, fields.Support) || Missing(snapshot, fields.ContainedIn))
        {
            return Invalid("no_such_entity");
        }
        var (located, location) = SpawnLocation(snapshot, edit);
        if (!located)
        {
            return Invalid("invalid_location");
        }
        if (location is not null && snapshot.Entities[location].Template != "room")
        {
            return Invalid("invalid_location");
        }
        // A location the chain does not give is a derived field written as something else; so is any modifier, since
        // every modifier is caused by an event.
        if (edit.Location is { } given
            && Placements.DerivedLocationOf(snapshot, fields.Support, fields.ContainedIn, out var derived)
            && derived != given.Value)
        {
            return Refused("derived_field");
        }
        if (edit.HasModifiers)
        {
            return Refused("derived_field");
        }
        // The definitions the spawn would carry are the template's, with the override's props merged over them.
        var carried = new Dictionary<string, JsonNode?>(template.Props, StringComparer.Ordinal);
        foreach (var (name, value) in fields.Props ?? new Dictionary<string, JsonNode?>())
        {
            carried[name] = value;
        }
        if (DefinitionWritten(template, carried) is not null)
        {
            return Refused("field_not_editable");
        }
        if (fields.Support is not null && snapshot.Entities.GetValueOrDefault(fields.Support)?.Template == "room")
        {
            if (fields.Pos is null)
            {
                return Refused("room_support_without_pos");
            }
        }
        else if (fields.Pos is not null)
        {
            return Refused("pos_without_room_support");
        }
        if (fields.DetachedFrom is { } origin)
        {
            if (!snapshot.Entities.TryGetValue(origin.Entity, out var owner)
                || !context.Registry.TryGetValue(owner.Template, out var ownerTemplate))
            {
                return Invalid("no_such_entity");
            }
            if (!ownerTemplate.Parts.Any(part => part.Name == origin.Part))
            {
                return Refused("unknown_part");
            }
        }
        return null;
    }

    private static bool Missing(Snapshot snapshot, string? id) => id is not null && !snapshot.Entities.ContainsKey(id);

    // An omitted location is derived from the chain, never left to drift; an explicit one is kept as it is named.
    private static (bool Located, string? Location) SpawnLocation(Snapshot snapshot, SpawnEdit edit)
    {
        if (edit.Location is { } given)
        {
            return (true, given.Value);
        }
        return Placements.DerivedLocationOf(snapshot, edit.Fields.Support, edit.Fields.ContainedIn, out var room)
            ? (true, room)
            : (false, null);
    }

    private static Pipeline.Refusal? RemoveRefusal(Snapshot snapshot, Entity subject)
    {
        if (subject.Template != "room")
        {
            return null;
        }
        return snapshot.Entities.Values.Any(entity => entity.Location == subject.Id) ? Refused("occupied_room") : null;
    }

    // Nothing is both held and supported: setting one relation clears the other, and asking for both is refused.
    private static (string? Support, string? Contained, Pos? Pos)? NormalizedPlacement(Entity subject, PlaceEdit edit)
    {
        if (edit.Support?.Value is not null && edit.ContainedIn?.Value is not null)
        {
            return null;
        }
        var support = edit.Support is { } named ? named.Value : subject.Support;
        var contained = edit.ContainedIn is { } inside ? inside.Value : subject.ContainedIn;
        if (edit.Support?.Value is not null)
        {
            contained = null;
        }
        else if (edit.ContainedIn?.Value is not null)
        {
            support = null;
        }
        return (support, contained, edit.Pos is { } pos ? pos.Value : subject.Pos);
    }

    // An anchor resolves to a plain position before any placement rule reads one: the offset against the anchor's own
    // position, and the anchor's room as the support. Nothing records the anchor, so the entity is simply there afterwards.
    // An anchor that is not standing in a room has no position to offset from, and is refused rather than guessed at.
    private static PlaceEdit ResolveAnchor(Snapshot snapshot, PlaceEdit edit, out Pipeline.Refusal? refusal)
    {
        refusal = null;
        if (edit.Anchor is not { } offset)
        {
            return edit;
        }
        // An anchor says where the entity is, so it cannot sit beside a holder the author also named.
        if (edit.Support?.Value is not null || edit.ContainedIn?.Value is not null)
        {
            refusal = Refused("conflicting_placement");
            return edit;
        }
        if (!snapshot.Entities.TryGetValue(offset.Anchor, out var anchor))
        {
            refusal = Invalid("no_such_entity");
            return edit;
        }
        var room = anchor.Support is null ? null : snapshot.Entities.GetValueOrDefault(anchor.Support);
        var at = room?.Template == "room" ? Geometry.EffectivePos(snapshot, anchor.Id) : null;
        if (at is not { } basePos)
        {
            refusal = Refused("anchor_not_room_supported");
            return edit;
        }
        return edit with
        {
            Support = new Given<string>(anchor.Support),
            ContainedIn = new Given<string>(null),
            Pos = new Given<Pos>(new Pos(basePos.X + offset.Dx, basePos.Y + offset.Dy)),
        };
    }

    private static Pipeline.Refusal? PlaceRefusal(Pipeline.CommandContext context, PlaceEdit edit, Entity subject)
    {
        edit = ResolveAnchor(context.Snapshot, edit, out var anchorRefusal);
        if (anchorRefusal is not null)
        {
            return anchorRefusal;
        }
        if (NormalizedPlacement(subject, edit) is not { } placement)
        {
            return Refused("conflicting_placement");
        }
        if (Missing(context.Snapshot, placement.Support) || Missing(context.Snapshot, placement.Contained))
        {
            return Invalid("no_such_entity");
        }
        if (placement.Support is not null && Address.WouldLoop(context.Snapshot, edit.Target, placement.Support))
        {
            return Refused("circular_placement");
        }
        if (placement.Contained is not null && Address.WouldLoop(context.Snapshot, edit.Target, placement.Contained))
        {
            return Refused("circular_placement");
        }
        if (placement.Support is not null && context.Snapshot.Entities[placement.Support].Template == "room")
        {
            return placement.Pos is null ? Refused("room_support_without_pos") : null;
        }
        return placement.Pos is not null ? Refused("pos_without_room_support") : null;
    }

    // Whether the role a command was sent under may send this kind of edit (src/engine/verbs/edit.ts `roleMay`): the author
    // may send any, and a director the run and beat ones (`docs/roles.md`).
    private static bool RoleMay(By by, WorldEdit edit) =>
        by.Role == Role.Author
        || (by.Role == Role.Director
            && edit is RegisterEdit or StartRunEdit or EndRunEdit or PlayBeatEdit or SteerEdit or CancelBeatEdit or RetimeBeatEdit);

    // A run no scene made has nothing to start or end; a run starts once, from registering, and ends from running.
    private static Pipeline.Refusal? RunEditRefusal(Snapshot snapshot, bool start)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused("no_run");
        }
        if (start)
        {
            return run.State == "registering" ? null : Refused("run_not_registering");
        }
        return run.State == "running" ? null : Refused("run_not_running");
    }

    // A registration binds a handle to one of a registering run's slots, named by its first body: one slot per handle, one
    // handle per slot.
    private static Pipeline.Refusal? RegisterRefusal(Snapshot snapshot, RegisterEdit edit)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused("no_run");
        }
        if (run.State != "registering")
        {
            return Refused("run_not_registering");
        }
        if (!Runs.SlotRoots(snapshot).Contains(edit.Slot))
        {
            return Refused("no_such_slot");
        }
        var players = run.Players ?? [];
        if (players.Any(player => player.Slot == edit.Slot))
        {
            return Refused("slot_taken");
        }
        return players.Any(player => player.Handle == edit.Handle) ? Refused("handle_taken") : null;
    }

    // A pool beat is played once, at a tick ahead of the clock, under an id nothing pending already carries.
    private static Pipeline.Refusal? PlayRefusal(Snapshot snapshot, PlayBeatEdit edit)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused("no_run");
        }
        if (!(run.Pool ?? []).Any(beat => PoolId(beat) == edit.Id))
        {
            return Refused("no_such_pool_beat");
        }
        if (edit.AtTick <= snapshot.Tick)
        {
            return Refused("beat_in_past");
        }
        return Beats.PendingBeatIds(Schedule.Pending(snapshot)).Contains(edit.Id) ? Refused("duplicate_beat") : null;
    }

    // A door's odds are steered only where the scene gave a range, and within it.
    private static Pipeline.Refusal? SteerRefusal(Snapshot snapshot, SteerEdit edit)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused("no_run");
        }
        var odds = (run.Odds ?? []).FirstOrDefault(entry => entry.Entity == edit.Entity && entry.Prop == "jam_pct");
        if (odds is null)
        {
            return Refused("not_steerable");
        }
        return edit.Value < odds.Min || edit.Value > odds.Max ? Refused("out_of_range") : null;
    }

    // The id a pool beat's body names, or null when it names none.
    private static string? PoolId(JsonObject beat) =>
        beat["id"] is JsonValue value && value.TryGetValue(out string? id) ? id : null;

    private static Pipeline.Refusal? BeatRefusal(Pipeline.CommandContext context, WorldEdit edit) => edit switch
    {
        ScheduleBeatEdit scheduled => ScheduleBeatRefusal(context, scheduled.Beat),
        CancelBeatEdit cancelled => Schedule.Pending(context.Snapshot).Any(cause => cause.Kind == "beat" && cause.Id == cancelled.Id)
            ? null
            : Refused("no_such_beat"),
        RetimeBeatEdit moved => RetimeBeatRefusal(context, moved),
        _ => throw new InvalidOperationException("Unknown beat edit"),
    };

    // Whether the beat may be scheduled now (src/engine/verbs/edit.ts scheduleBeatRefusal): its subject is there, every entity
    // an `all` reads is there, nothing it writes is refused, it is not in the past, and its ids are new and within the bound.
    private static Pipeline.Refusal? ScheduleBeatRefusal(Pipeline.CommandContext context, JsonObject beat)
    {
        var snapshot = context.Snapshot;
        var subject = Beats.ActionSubject((JsonObject)beat["action"]!);
        if (subject is null || !snapshot.Entities.ContainsKey(subject))
        {
            return Invalid("no_such_entity");
        }
        foreach (var condition in Beats.EditConditions(beat))
        {
            if (condition is JsonObject { } obj && obj.ContainsKey("all")
                && Beats.ConditionSubjects(condition).Any(id => !snapshot.Entities.ContainsKey(id)))
            {
                return Invalid("no_such_entity");
            }
        }
        foreach (var action in Beats.EditActions(beat))
        {
            if (Beats.PropRefusal(snapshot, context.Registry, action) is { } code)
            {
                return Refused(code);
            }
        }
        if (Int(beat["at_tick"]) is not { } atTick)
        {
            return Invalid("invalid_args");
        }
        if (atTick <= snapshot.Tick)
        {
            return Refused("beat_in_past");
        }
        var ids = Beats.EditIds(beat);
        var taken = Beats.PendingBeatIds(Schedule.Pending(snapshot));
        if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Count || ids.Any(id => taken.Contains(id)))
        {
            return Refused("duplicate_beat");
        }
        return ids.Count + taken.Count > Beats.MaxBeats ? Refused("too_many_beats") : null;
    }

    // Whether the beat may be moved now (src/engine/verbs/edit.ts retimeBeatRefusal): it is pending, nothing it would write is
    // refused, and its new tick is not in the past.
    private static Pipeline.Refusal? RetimeBeatRefusal(Pipeline.CommandContext context, RetimeBeatEdit edit)
    {
        var cause = Schedule.Pending(context.Snapshot).FirstOrDefault(entry => entry.Kind == "beat" && entry.Id == edit.Id);
        if (cause is null)
        {
            return Refused("no_such_beat");
        }
        // A beat queued with a write to a definition is not moved to a tick where it would be skipped: the same refusal a
        // schedule gives.
        var beat = new JsonObject { ["action"] = cause.Action!.DeepClone(), ["then"] = cause.Then?.DeepClone() };
        foreach (var action in Beats.EditActions(beat))
        {
            if (Beats.PropRefusal(context.Snapshot, context.Registry, action) is { } code)
            {
                return Refused(code);
            }
        }
        return edit.AtTick <= context.Snapshot.Tick ? Refused("beat_in_past") : null;
    }

    private static Pipeline.Refusal? PropsRefusal(Pipeline.CommandContext context, Entity subject, PropsEdit edit)
    {
        if (!context.Registry.TryGetValue(subject.Template, out var template))
        {
            return Invalid("unknown_template");
        }
        // `set_props` replaces every prop, so it must carry the template's definitions along; `update_props` merges.
        IReadOnlyDictionary<string, JsonNode?> resulting = edit.Kind == "set_props"
            ? edit.Props
            : Merge(subject.Props, edit.Props);
        return DefinitionWritten(template, resulting) is null ? null : Refused("field_not_editable");
    }

    private static Pipeline.Refusal? PartRefusal(IReadOnlyDictionary<string, Template> registry, Entity subject, string part)
    {
        if (!registry.TryGetValue(subject.Template, out var template))
        {
            return Invalid("unknown_template");
        }
        return template.Parts.Any(decl => decl.Name == part) ? null : Refused("unknown_part");
    }

    // The definition prop a write changes, or null. An entity stores a copy of its template's props, so repeating a
    // definition is no change; writing a different one, or dropping one, is.
    internal static string? DefinitionWritten(Template template, IReadOnlyDictionary<string, JsonNode?> resulting)
    {
        bool IsDefinition(string name) =>
            PropFields.Table.TryGetValue(name, out var field) && field.Tier == Tier.Definition
            || template.Fields is not null && template.Fields.TryGetValue(name, out var declared) && declared.Tier == "definition";

        var names = template.Props.Keys.Concat(resulting.Keys).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
        foreach (var name in names)
        {
            if (IsDefinition(name) && !SameValue(template.Props.GetValueOrDefault(name), resulting.GetValueOrDefault(name)))
            {
                return name;
            }
        }
        return null;
    }

    private static bool SameValue(JsonNode? left, JsonNode? right) =>
        left is null || right is null ? left is null && right is null : left.ToJsonString() == right.ToJsonString();

    private static Dictionary<string, JsonNode?> Merge(IReadOnlyDictionary<string, JsonNode?> basis, IReadOnlyDictionary<string, JsonNode?> changes)
    {
        var merged = new Dictionary<string, JsonNode?>(basis, StringComparer.Ordinal);
        foreach (var (name, value) in changes)
        {
            merged[name] = value?.DeepClone();
        }
        return merged;
    }

    private static Pipeline.Refusal? ValidateResult(Pipeline.CommandContext context)
    {
        var first = SnapshotValidation.Validate(context.Snapshot, context.Registry).FirstOrDefault();
        if (first is null)
        {
            return null;
        }
        if (first.Code == "support_or_containment_cycle")
        {
            return Refused("circular_placement");
        }
        if (!Refuses.Contains(first.Code))
        {
            throw new InvalidOperationException($"Verb edit refused with undeclared code {first.Code}");
        }
        return Refused(first.Code);
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string rootEventId)
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
                    Schedule.Pending(working.Snapshot).Where(cause => cause.Kind != "beat" || cause.Id != cancelled.Id).ToList());
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
    private static void TransitionPlay(Working working, PlayBeatEdit edit, string rootEventId)
    {
        var run = working.Snapshot.Run ?? throw new InvalidOperationException("Play without a run after validation");
        var pool = run.Pool ?? [];
        var beat = pool.FirstOrDefault(entry => PoolId(entry) == edit.Id)
            ?? throw new InvalidOperationException("Play changed after validation");
        working.SetRun(run with { Pool = pool.Where(entry => PoolId(entry) != edit.Id).ToList() });
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
        var steered = (run.Steered ?? []).Where(entry => !(entry.Entity == edit.Entity && entry.Prop == "jam_pct")).ToList();
        steered.Add(new Steered(edit.Entity, "jam_pct", edit.Value));
        working.SetRun(run with { Steered = steered });
    }

    // The template changes, and the props and parts take what the new preset keeps of the entity's state. The subject is the
    // entity before the edit, so both are read from it, as src/engine/verbs/edit.ts does.
    // Taken off and put back at its new tick, so it runs after whatever is already due then, as if scheduled now.
    private static void TransitionRetime(Working working, RetimeBeatEdit edit)
    {
        var list = Schedule.Pending(working.Snapshot).ToList();
        var index = list.FindIndex(entry => entry.Kind == "beat" && entry.Id == edit.Id);
        if (index < 0)
        {
            throw new InvalidOperationException("Edit changed after validation");
        }
        var cause = list[index];
        list.RemoveAt(index);
        Schedule.Replace(working, list);
        Schedule.Add(working, cause with { DueTick = edit.AtTick });
    }

    private static void TransitionRefine(Working working, Pipeline.CommandContext context, RefineEdit edit, string rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        var next = context.Registry[edit.Template];
        var edited = working.Emit(
            "edited",
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

    private static void TransitionPlace(Working working, Pipeline.CommandContext context, PlaceEdit edit, string rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        edit = ResolveAnchor(context.Snapshot, edit, out var anchorRefusal);
        if (anchorRefusal is not null)
        {
            throw new InvalidOperationException("Edit placement changed after validation");
        }
        var placement = NormalizedPlacement(subject, edit) ?? throw new InvalidOperationException("Edit placement changed after validation");
        var placed = working.Emit("placed", edit.Target, new Dictionary<string, JsonNode?>(), rootEventId);
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

    private static void TransitionProps(Working working, Pipeline.CommandContext context, PropsEdit edit, string rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        var edited = working.Emit("edited", edit.Target, Pipeline.Reason(("field", "props")), rootEventId);
        IReadOnlyDictionary<string, JsonNode?> basis = edit.Kind == "update_props" ? subject.Props : new Dictionary<string, JsonNode?>();
        working.SetProps(edit.Target, Merge(basis, edit.Props), edited);
    }

    private static void TransitionPart(Working working, Pipeline.CommandContext context, SetPartEdit edit, string rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
        var edited = working.Emit("edited", edit.Target, Pipeline.Reason(("field", "parts"), ("part", edit.Part)), rootEventId);
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

    // Reads the `edit` argument (src/engine/verbs/edit.ts `parseEdit`): null when it is not a well-formed edit, and an
    // exception for a kind or field this port does not carry.
    // Whether a JSON object reads as an edit, the action of a beat (src/engine/beats.ts parseAction).
    internal static bool ParsesAsEdit(JsonObject action) =>
        Parse(new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["edit"] = action.DeepClone() }) is not null;

    private static WorldEdit? Parse(IReadOnlyDictionary<string, JsonNode?>? args)
    {
        if (args is null || !args.TryGetValue("edit", out var node) || node is not JsonObject obj || Text(obj["kind"]) is not { } kind)
        {
            return null;
        }
        switch (kind)
        {
            case "spawn":
            {
                if (!Only(obj, "kind", "template", "overrides") || Text(obj["template"]) is not { } template)
                {
                    return null;
                }
                if (obj["overrides"] is null)
                {
                    return new SpawnEdit(template, null, new Spawn.Overrides(), false);
                }
                if (obj["overrides"] is not JsonObject overrides || !overrides.All(pair => OverrideKeys.Contains(pair.Key)))
                {
                    return null;
                }
                return ParseOverrides(template, overrides);
            }
            case "set_seed":
            {
                if (!Only(obj, "kind", "seed") || Int(obj["seed"]) is not { } seed || !Rng.IsState(seed))
                {
                    return null;
                }
                return new SetSeedEdit(seed);
            }
            case "schedule_beat":
            {
                return Beats.ParseScheduleBeat(obj) ? new ScheduleBeatEdit((JsonObject)obj.DeepClone()) : null;
            }
            case "cancel_beat":
            {
                return Only(obj, "kind", "id") && Text(obj["id"]) is { } cancelled && Beats.IsBeatId(cancelled)
                    ? new CancelBeatEdit(cancelled)
                    : null;
            }
            case "retime_beat":
            {
                return Only(obj, "kind", "id", "at_tick") && Text(obj["id"]) is { } moved && Beats.IsBeatId(moved) && Int(obj["at_tick"]) is { } tick
                    ? new RetimeBeatEdit(moved, tick)
                    : null;
            }
            case "register_player":
            {
                return Only(obj, "kind", "handle", "slot") && Text(obj["handle"]) is { } handle && Beats.IsBeatId(handle)
                    && Text(obj["slot"]) is { } slot
                    ? new RegisterEdit(handle, slot)
                    : null;
            }
            case "play_beat":
            {
                return Only(obj, "kind", "id", "at_tick") && Text(obj["id"]) is { } played && Beats.IsBeatId(played)
                    && Int(obj["at_tick"]) is { } tick
                    ? new PlayBeatEdit(played, tick)
                    : null;
            }
            case "steer":
            {
                return Only(obj, "kind", "entity", "prop", "value") && Text(obj["entity"]) is { } entity
                    && Text(obj["prop"]) == "jam_pct" && Int(obj["value"]) is { } value
                    ? new SteerEdit(entity, value)
                    : null;
            }
            case "start_run":
                return Only(obj, "kind") ? new StartRunEdit() : null;
            case "end_run":
                return Only(obj, "kind") ? new EndRunEdit() : null;
            case "refine":
            {
                if (!Only(obj, "kind", "target", "template") || Text(obj["target"]) is not { } target || Text(obj["template"]) is not { } template)
                {
                    return null;
                }
                return new RefineEdit(target, template);
            }
            case "remove":
            {
                if (!Only(obj, "kind", "target") || Text(obj["target"]) is not { } target)
                {
                    return null;
                }
                return new RemoveEdit(target);
            }
            case "place":
            {
                if (!Only(obj, "kind", "target", "support", "contained_in", "in_part", "concealed_by", "pos")
                    || Text(obj["target"]) is not { } target)
                {
                    return null;
                }
                AnchorOffset? anchor = null;
                if (obj["pos"] is JsonObject offset && !IsPlainPos(offset) && IsAnchor(offset))
                {
                    anchor = new AnchorOffset(Text(offset["anchor"])!, Int(offset["dx"])!.Value, Int(offset["dy"])!.Value);
                }
                Given<Pos>? pos = null;
                if (!Ref(obj, "support", out var support)
                    || !Ref(obj, "contained_in", out var containedIn)
                    || !Ref(obj, "in_part", out var inPart)
                    || !Ref(obj, "concealed_by", out var concealedBy)
                    || (anchor is null && !PosField(obj, "pos", out pos)))
                {
                    return null;
                }
                return new PlaceEdit(target, support, containedIn, inPart, concealedBy, pos, anchor);
            }
            case "set_props":
            case "update_props":
            {
                if (!Only(obj, "kind", "target", "props") || Text(obj["target"]) is not { } target
                    || obj["props"] is not JsonObject props || !props.All(pair => IsPrimitive(pair.Value)))
                {
                    return null;
                }
                return new PropsEdit(kind, target, props.ToDictionary(pair => pair.Key, pair => pair.Value?.DeepClone(), StringComparer.Ordinal));
            }
            case "set_part":
            {
                if (!Only(obj, "kind", "target", "part", "state") || Text(obj["target"]) is not { } target
                    || Text(obj["part"]) is not { } part || obj["state"] is not JsonObject state
                    || Int(state["integrity"]) is not { } integrity || Text(state["status"]) is not { } status)
                {
                    return null;
                }
                var partStatus = status switch
                {
                    "intact" => PartStatus.Intact,
                    "damaged" => PartStatus.Damaged,
                    "detached" => PartStatus.Detached,
                    "destroyed" => PartStatus.Destroyed,
                    _ => (PartStatus?)null,
                };
                return partStatus is { } value ? new SetPartEdit(target, part, new PartState(integrity, value)) : null;
            }
            default:
                return null;
        }
    }

    // The overrides of a spawn, each field as TypeScript's isOverrides reads it: absent is the blank field, null where the
    // field takes null, and a value the field cannot hold makes the edit malformed (null). An explicit null in_part and a
    // trait that is not a token string are not ported and are refused loudly.
    private static SpawnEdit? ParseOverrides(string template, JsonObject overrides)
    {
        string? name = null;
        if (overrides.ContainsKey("name"))
        {
            if (Text(overrides["name"], allowEmpty: true) is not { } given)
            {
                return null;
            }
            name = given;
        }
        if (!Ref(overrides, "location", out var location)
            || !Ref(overrides, "support", out var support)
            || !Ref(overrides, "contained_in", out var containedIn)
            || !Ref(overrides, "concealed_by", out var concealedBy)
            || !PosField(overrides, "pos", out var pos)
            || !Origin(overrides, out var origin)
            || !Integrity(overrides, out var integrity))
        {
            return null;
        }
        string? inPart = null;
        if (overrides.ContainsKey("in_part"))
        {
            if (overrides["in_part"] is null)
            {
                throw new NotPortedException("spawn with an explicit null in_part");
            }
            if (Text(overrides["in_part"], allowEmpty: true) is not { } part)
            {
                return null;
            }
            inPart = part;
        }
        var props = Props(overrides);
        if (overrides.ContainsKey("props") && props is null)
        {
            return null;
        }
        var aliases = Aliases(overrides);
        if (overrides.ContainsKey("aliases") && aliases is null)
        {
            return null;
        }
        var traits = Traits(overrides);
        if (overrides.ContainsKey("traits") && traits is null)
        {
            return null;
        }
        var residue = Residue(overrides);
        if (overrides.ContainsKey("residue") && residue is null)
        {
            return null;
        }
        var status = StatusOf(overrides);
        if (overrides.ContainsKey("status") && status is null)
        {
            return null;
        }
        if (overrides.ContainsKey("modifiers") && !Modifiers(overrides["modifiers"]))
        {
            return null;
        }
        return new SpawnEdit(
            template,
            location,
            new Spawn.Overrides(
                Name: name,
                Support: support?.Value,
                ContainedIn: containedIn?.Value,
                Pos: pos?.Value,
                Integrity: integrity,
                DetachedFrom: origin,
                Props: props,
                Aliases: aliases,
                Traits: traits,
                ConcealedBy: concealedBy?.Value,
                Residue: residue,
                Status: status?.Value,
                InPart: inPart),
            overrides.ContainsKey("modifiers") && overrides["modifiers"] is JsonArray { Count: > 0 });
    }

    // A map of props, each a number, a string or a boolean; null when it is not one.
    private static Dictionary<string, JsonNode?>? Props(JsonObject overrides)
    {
        if (!overrides.TryGetPropertyValue("props", out var node))
        {
            return null;
        }
        return node is JsonObject props && props.All(pair => IsPrimitive(pair.Value))
            ? props.ToDictionary(pair => pair.Key, pair => pair.Value?.DeepClone(), StringComparer.Ordinal)
            : null;
    }

    // A list of strings; null when it is not one.
    private static List<string>? Aliases(JsonObject overrides)
    {
        if (!overrides.TryGetPropertyValue("aliases", out var node))
        {
            return null;
        }
        if (node is not JsonArray array)
        {
            return null;
        }
        var aliases = new List<string>(array.Count);
        foreach (var element in array)
        {
            if (Text(element, allowEmpty: true) is not { } alias)
            {
                return null;
            }
            aliases.Add(alias);
        }
        return aliases;
    }

    // A map of trait keys to strings; null when it is not a map, and an exception for a value that is not a string, which
    // TypeScript refuses only in validation (`invalid_trait`).
    private static Dictionary<string, string>? Traits(JsonObject overrides)
    {
        if (!overrides.TryGetPropertyValue("traits", out var node))
        {
            return null;
        }
        if (node is not JsonObject traits)
        {
            return null;
        }
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, value) in traits)
        {
            if (Text(value, allowEmpty: true) is not { } token)
            {
                throw new NotPortedException("spawn trait that is not a string");
            }
            result[key] = token;
        }
        return result;
    }

    // A map of residue to whole amounts; null when it is not one.
    private static Dictionary<string, long>? Residue(JsonObject overrides)
    {
        if (!overrides.TryGetPropertyValue("residue", out var node))
        {
            return null;
        }
        if (node is not JsonObject residue)
        {
            return null;
        }
        var result = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var (key, value) in residue)
        {
            if (Int(value) is not { } amount)
            {
                return null;
            }
            result[key] = amount;
        }
        return result;
    }

    // The state a spawn starts in: intact, broken or destroyed; null when it is none of those.
    private static Given<EntityStatus>? StatusOf(JsonObject overrides)
    {
        if (!overrides.TryGetPropertyValue("status", out var node))
        {
            return null;
        }
        return Text(node) switch
        {
            "intact" => new Given<EntityStatus>(EntityStatus.Intact),
            "broken" => new Given<EntityStatus>(EntityStatus.Broken),
            "destroyed" => new Given<EntityStatus>(EntityStatus.Destroyed),
            _ => null,
        };
    }

    // Whether a spawn's modifiers are well formed: a list of records each with a capacity, a whole delta, an optional
    // expiry and a cause. Any modifier at all is refused by the caller; this only says the list is well formed.
    private static bool Modifiers(JsonNode? node)
    {
        if (node is not JsonArray array)
        {
            return false;
        }
        return array.All(modifier =>
            modifier is JsonObject record
            && Text(record["capacity"], allowEmpty: true) is not null
            && Int(record["delta"]) is not null
            && (record["expires_at_tick"] is null || Int(record["expires_at_tick"]) is not null)
            && Text(record["cause_id"]) is not null);
    }

    private static bool Only(JsonObject obj, params string[] allowed) => obj.All(pair => allowed.Contains(pair.Key));

    // A non-empty string, or any string when `allowEmpty`; null for anything else.
    private static string? Text(JsonNode? node, bool allowEmpty = false) =>
        node is JsonValue value && value.TryGetValue(out string? text) && (allowEmpty || text.Length > 0) ? text : null;

    // A safe integer, or null when the node is not one.
    private static long? Int(JsonNode? node)
    {
        if (node is not JsonValue value || value.GetValueKind() != JsonValueKind.Number)
        {
            return null;
        }
        var number = PropFields.Number(value);
        return number is { } n && Math.Floor(n) == n && Math.Abs(n) <= 9007199254740991 ? (long)n : null;
    }

    // A reference field that is absent (no Given), null (a clear) or an id. False for anything else.
    private static bool Ref(JsonObject obj, string key, out Given<string>? given)
    {
        given = null;
        if (!obj.TryGetPropertyValue(key, out var node))
        {
            return true;
        }
        if (node is null)
        {
            given = new Given<string>(null);
            return true;
        }
        var id = Text(node);
        given = id is null ? null : new Given<string>(id);
        return id is not null;
    }

    // A position field that is absent, null, or a plain position; an anchor form is refused loudly by the caller.
    private static bool PosField(JsonObject obj, string key, out Given<Pos>? given)
    {
        given = null;
        if (!obj.TryGetPropertyValue(key, out var node))
        {
            return true;
        }
        if (node is null)
        {
            given = new Given<Pos>(null);
            return true;
        }
        if (node is JsonObject plain && IsPlainPos(plain))
        {
            given = new Given<Pos>(new Pos(Int(plain["x"])!.Value, Int(plain["y"])!.Value));
            return true;
        }
        return false;
    }

    // The detached_from origin of a spawn: null, or an entity and a part.
    private static bool Origin(JsonObject obj, out DetachedFrom? origin)
    {
        origin = null;
        if (!obj.TryGetPropertyValue("detached_from", out var node) || node is null)
        {
            return true;
        }
        if (node is not JsonObject record || Text(record["entity"]) is not { } entity || Text(record["part"]) is not { } part)
        {
            return false;
        }
        origin = new DetachedFrom(entity, part);
        return true;
    }

    // The spawn's integrity: absent, or a safe integer.
    private static bool Integrity(JsonObject obj, out long? integrity)
    {
        integrity = null;
        if (!obj.TryGetPropertyValue("integrity", out var node))
        {
            return true;
        }
        integrity = Int(node);
        return integrity is not null;
    }

    private static bool IsPlainPos(JsonObject obj) =>
        obj.Count == 2 && obj.ContainsKey("x") && obj.ContainsKey("y") && Int(obj["x"]) is not null && Int(obj["y"]) is not null;

    private static bool IsAnchor(JsonObject obj) =>
        obj.All(pair => pair.Key is "anchor" or "dx" or "dy") && Text(obj["anchor"]) is not null && Int(obj["dx"]) is not null && Int(obj["dy"]) is not null;

    private static bool IsPrimitive(JsonNode? node) =>
        node is JsonValue value && (value.GetValueKind() is JsonValueKind.String or JsonValueKind.True or JsonValueKind.False or JsonValueKind.Number);
}
