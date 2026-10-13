using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The edit verb's refusals (src/engine/verbs/edit.ts `preconditions`): what each kind of edit is refused, and the check on the
// snapshot an edit leaves.
public static partial class EditVerb
{
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
        if (location is not null && snapshot.Entities[location].Template != TemplateIds.Room)
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
        if (fields.Support is not null && snapshot.Entities.GetValueOrDefault(fields.Support)?.Template == TemplateIds.Room)
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
        if (subject.Template != TemplateIds.Room)
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
        var at = room?.Template == TemplateIds.Room ? Geometry.EffectivePos(snapshot, anchor.Id) : null;
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
        if (placement.Support is not null && context.Snapshot.Entities[placement.Support].Template == TemplateIds.Room)
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

}
