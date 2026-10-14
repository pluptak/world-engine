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
        AfflictEdit afflict => afflict.Target,
        _ => throw new InvalidOperationException("Edit has no target"),
    };

    private static Pipeline.Refusal? SpawnRefusal(Pipeline.CommandContext context, SpawnEdit edit)
    {
        var snapshot = context.Snapshot;
        var fields = edit.Fields;
        if (!context.Registry.TryGetValue(edit.Template, out var template))
        {
            return Invalid(Code.UnknownTemplate);
        }
        if (fields.Support is not null && fields.ContainedIn is not null)
        {
            return Refused(Code.ConflictingPlacement);
        }
        if (Missing(snapshot, edit.Location?.Value) || Missing(snapshot, fields.Support) || Missing(snapshot, fields.ContainedIn))
        {
            return Invalid(Code.NoSuchEntity);
        }
        var (located, location) = SpawnLocation(snapshot, edit);
        if (!located)
        {
            return Invalid(Code.InvalidLocation);
        }
        if (location is not null && snapshot.Entities[location].Template != TemplateIds.Room)
        {
            return Invalid(Code.InvalidLocation);
        }
        // A location the chain does not give is a derived field written as something else; so is any modifier, since
        // every modifier is caused by an event.
        if (edit.Location is { } given
            && Placements.DerivedLocationOf(snapshot, fields.Support, fields.ContainedIn, out var derived)
            && derived != given.Value)
        {
            return Refused(Code.DerivedField);
        }
        if (edit.HasModifiers)
        {
            return Refused(Code.DerivedField);
        }
        // The definitions the spawn would carry are the template's, with the override's props merged over them.
        if (DefinitionWritten(template, Merge(template.Props, fields.Props ?? Value.Map.Empty)) is not null)
        {
            return Refused(Code.FieldNotEditable);
        }
        if (fields.Support is not null && snapshot.Entities.GetValueOrDefault(fields.Support)?.Template == TemplateIds.Room)
        {
            if (fields.Pos is null)
            {
                return Refused(Code.RoomSupportWithoutPos);
            }
        }
        else if (fields.Pos is not null)
        {
            return Refused(Code.PosWithoutRoomSupport);
        }
        if (fields.DetachedFrom is { } origin)
        {
            if (!snapshot.Entities.TryGetValue(origin.Entity, out var owner)
                || !context.Registry.TryGetValue(owner.Template, out var ownerTemplate))
            {
                return Invalid(Code.NoSuchEntity);
            }
            if (!ownerTemplate.Parts.Any(part => part.Name == origin.Part))
            {
                return Refused(Code.UnknownPart);
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
        return snapshot.Entities.Values.Any(entity => entity.Location == subject.Id) ? Refused(Code.OccupiedRoom) : null;
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
            refusal = Refused(Code.ConflictingPlacement);
            return edit;
        }
        if (!snapshot.Entities.TryGetValue(offset.Anchor, out var anchor))
        {
            refusal = Invalid(Code.NoSuchEntity);
            return edit;
        }
        var room = anchor.Support is null ? null : snapshot.Entities.GetValueOrDefault(anchor.Support);
        var at = room?.Template == TemplateIds.Room ? Geometry.EffectivePos(snapshot, anchor.Id) : null;
        if (at is not { } basePos)
        {
            refusal = Refused(Code.AnchorNotRoomSupported);
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
            return Refused(Code.ConflictingPlacement);
        }
        if (Missing(context.Snapshot, placement.Support) || Missing(context.Snapshot, placement.Contained))
        {
            return Invalid(Code.NoSuchEntity);
        }
        if (placement.Support is not null && Address.WouldLoop(context.Snapshot, edit.Target, placement.Support))
        {
            return Refused(Code.CircularPlacement);
        }
        if (placement.Contained is not null && Address.WouldLoop(context.Snapshot, edit.Target, placement.Contained))
        {
            return Refused(Code.CircularPlacement);
        }
        if (placement.Support is not null && context.Snapshot.Entities[placement.Support].Template == TemplateIds.Room)
        {
            return placement.Pos is null ? Refused(Code.RoomSupportWithoutPos) : null;
        }
        return placement.Pos is not null ? Refused(Code.PosWithoutRoomSupport) : null;
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
            return Refused(Code.NoRun);
        }
        if (start)
        {
            return run.State == "registering" ? null : Refused(Code.RunNotRegistering);
        }
        return run.State == "running" ? null : Refused(Code.RunNotRunning);
    }

    // A registration binds a handle to one of a registering run's slots, named by its first body: one slot per handle, one
    // handle per slot.
    private static Pipeline.Refusal? RegisterRefusal(Snapshot snapshot, RegisterEdit edit)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused(Code.NoRun);
        }
        if (run.State != "registering")
        {
            return Refused(Code.RunNotRegistering);
        }
        if (!Runs.SlotRoots(snapshot).Contains(edit.Slot))
        {
            return Refused(Code.NoSuchSlot);
        }
        var players = run.Players ?? [];
        if (players.Any(player => player.Slot == edit.Slot))
        {
            return Refused(Code.SlotTaken);
        }
        return players.Any(player => player.Handle == edit.Handle) ? Refused(Code.HandleTaken) : null;
    }

    // A pool beat is played once, at a tick ahead of the clock, under an id nothing pending already carries.
    private static Pipeline.Refusal? PlayRefusal(Snapshot snapshot, PlayBeatEdit edit)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused(Code.NoRun);
        }
        if (!(run.Pool ?? []).Any(beat => beat.Id == edit.Id))
        {
            return Refused(Code.NoSuchPoolBeat);
        }
        if (edit.AtTick <= snapshot.Tick)
        {
            return Refused(Code.BeatInPast);
        }
        return Beats.PendingBeatIds(Schedule.Pending(snapshot)).Contains(edit.Id) ? Refused(Code.DuplicateBeat) : null;
    }

    // A door's odds are steered only where the scene gave a range, and within it.
    private static Pipeline.Refusal? SteerRefusal(Snapshot snapshot, SteerEdit edit)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return Refused(Code.NoRun);
        }
        var odds = (run.Odds ?? []).FirstOrDefault(entry => entry.Entity == edit.Entity && entry.Prop == Prop.JamPct);
        if (odds is null)
        {
            return Refused(Code.NotSteerable);
        }
        return edit.Value < odds.Min || edit.Value > odds.Max ? Refused(Code.OutOfRange) : null;
    }

    private static Pipeline.Refusal? BeatRefusal(Pipeline.CommandContext context, WorldEdit edit) => edit switch
    {
        ScheduleBeatEdit scheduled => ScheduleBeatRefusal(context, scheduled.Beat),
        CancelBeatEdit cancelled => Schedule.Pending(context.Snapshot).OfType<BeatCause>().Any(found => found.Id == cancelled.Id)
            ? null
            : Refused(Code.NoSuchBeat),
        RetimeBeatEdit moved => RetimeBeatRefusal(context, moved),
        _ => throw new InvalidOperationException("Unknown beat edit"),
    };

    // Whether the beat may be scheduled now (src/engine/verbs/edit.ts scheduleBeatRefusal): its subject is there, every entity
    // an `all` reads is there, nothing it writes is refused, it is not in the past, and its ids are new and within the bound.
    private static Pipeline.Refusal? ScheduleBeatRefusal(Pipeline.CommandContext context, BeatCause beat)
    {
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.ContainsKey(beat.Entity)
            || Beats.Conditions(beat.OnlyIf, beat.Then).Any(condition => Beats.ConditionSubjects(condition).Any(id => !snapshot.Entities.ContainsKey(id))))
        {
            return Invalid(Code.NoSuchEntity);
        }
        foreach (var action in Beats.Actions(beat.Action, beat.Then))
        {
            if (Beats.PropRefusal(snapshot, context.Registry, action) is { } code)
            {
                return Refused(code);
            }
        }
        if (beat.DueTick <= snapshot.Tick)
        {
            return Refused(Code.BeatInPast);
        }
        var ids = Beats.Ids(beat.Id, beat.Then).ToList();
        var taken = Beats.PendingBeatIds(Schedule.Pending(snapshot));
        if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Count || ids.Any(id => taken.Contains(id)))
        {
            return Refused(Code.DuplicateBeat);
        }
        return ids.Count + taken.Count > Beats.MaxBeats ? Refused(Code.TooManyBeats) : null;
    }

    // Whether the beat may be moved now (src/engine/verbs/edit.ts retimeBeatRefusal): it is pending, nothing it would write is
    // refused, and its new tick is not in the past.
    private static Pipeline.Refusal? RetimeBeatRefusal(Pipeline.CommandContext context, RetimeBeatEdit edit)
    {
        var cause = Schedule.Pending(context.Snapshot).OfType<BeatCause>().FirstOrDefault(found => found.Id == edit.Id);
        if (cause is null)
        {
            return Refused(Code.NoSuchBeat);
        }
        // A beat queued with a write to a definition is not moved to a tick where it would be skipped: the same refusal a
        // schedule gives.
        foreach (var action in Beats.Actions(cause.Action, cause.Then))
        {
            if (Beats.PropRefusal(context.Snapshot, context.Registry, action) is { } code)
            {
                return Refused(code);
            }
        }
        return edit.AtTick <= context.Snapshot.Tick ? Refused(Code.BeatInPast) : null;
    }

    private static Pipeline.Refusal? PropsRefusal(Pipeline.CommandContext context, Entity subject, PropsEdit edit)
    {
        if (!context.Registry.TryGetValue(subject.Template, out var template))
        {
            return Invalid(Code.UnknownTemplate);
        }
        // `set_props` replaces every prop, so it must carry the template's definitions along; `update_props` merges.
        var resulting = edit.Kind == "set_props" ? edit.Props : Merge(subject.Props, edit.Props);
        return DefinitionWritten(template, resulting) is null ? null : Refused(Code.FieldNotEditable);
    }

    // An affliction lands on a capacity the body has, and holds from a tick still to come. A body with no parts has none.
    private static Pipeline.Refusal? AfflictRefusal(Pipeline.CommandContext context, Entity subject, AfflictEdit edit)
    {
        if (edit.Until <= context.Snapshot.Tick)
        {
            return Invalid(Code.InvalidTick);
        }
        var capacities = Capacities.All(context.Snapshot, context.Registry, subject.Id);
        return capacities is not null && capacities.ContainsKey(edit.Capacity) ? null : Refused(Code.UnknownCapacity);
    }

    private static Pipeline.Refusal? PartRefusal(IReadOnlyDictionary<string, Template> registry, Entity subject, string part)
    {
        if (!registry.TryGetValue(subject.Template, out var template))
        {
            return Invalid(Code.UnknownTemplate);
        }
        return template.Parts.Any(decl => decl.Name == part) ? null : Refused(Code.UnknownPart);
    }

    // The definition prop a write changes, or null. An entity stores a copy of its template's props, so repeating a
    // definition is no change; writing a different one, or dropping one, is.
    internal static string? DefinitionWritten(Template template, IReadOnlyDictionary<string, Value> resulting)
    {
        bool IsDefinition(string name) =>
            Prop.Table.TryGetValue(name, out var field) && field.Tier == Tier.Definition
            || template.Fields is not null && template.Fields.TryGetValue(name, out var declared) && declared.Tier == "definition";

        var names = template.Props.Keys.Concat(resulting.Keys).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal);
        foreach (var name in names)
        {
            if (IsDefinition(name) && !Prop.SameValue(template.Props.GetValueOrDefault(name), resulting.GetValueOrDefault(name)))
            {
                return name;
            }
        }
        return null;
    }

    private static Value.Map Merge(Value.Map basis, Value.Map changes) =>
        changes.Aggregate(basis, (merged, change) => merged.With(change.Key, change.Value));

    private static Pipeline.Refusal? ValidateResult(Pipeline.CommandContext context)
    {
        var first = SnapshotValidation.Validate(context.Snapshot, context.Registry).FirstOrDefault();
        if (first is null)
        {
            return null;
        }
        if (first.Code == Code.SupportOrContainmentCycle)
        {
            return Refused(Code.CircularPlacement);
        }
        // An undeclared code is the pipeline's to catch (`AssertDeclared`), as in TypeScript; a beat's edit asks this too, and treats any
        // refusal as a failed beat.
        return Refused(first.Code);
    }

}
