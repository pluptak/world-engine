using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The world author's `edit` (src/engine/verbs/edit.ts): spawn, remove, place, set_props, update_props, set_part, set_seed,
// refine, the beat edits, and the run and role edits (start_run, end_run, register_player, play_beat, steer). The result is
// judged by the snapshot invariants, so an edit that would break one is refused and nothing is written.
public static partial class EditVerb
{
    public static Pipeline.VerbDecl Edit { get; } = new(
        RequiresTarget: false,
        AuthorOnly: true,
        Preconditions: Preconditions,
        Duration: VerbDuration.Fixed(0),
        Transition: Transition,
        ValidateResult: ValidateResult);

    // The refusal codes this verb may answer with (src/engine/verbs/edit.ts `refuses`). A validation code outside them is
    // a verb bug, which TypeScript throws on and so does this.
    private static readonly HashSet<Code> Refuses =
    [
        Code.DerivedField, Code.FieldNotEditable, Code.RoomPlaced, Code.ConflictingPlacement, Code.RoomSupportWithoutPos,
        Code.PosWithoutRoomSupport, Code.AnchorNotRoomSupported, Code.CircularPlacement, Code.OccupiedRoom, Code.UnknownPart,
        Code.NotARefinement, Code.TooLarge, Code.NotASurface, Code.LiquidExceedsCapacity, Code.IntegrityOutOfRange,
        Code.DetachedPartWithoutEntity, Code.PartAtDefault, Code.PartUnderDetached, Code.CoverageNotComputable,
        Code.LocationMismatch, Code.DanglingReference, Code.IdNotBelowNextSeq, Code.SupportOrContainmentCycle,
        Code.SupportAndContainedIn, Code.DoorSideNotRoom, Code.OpensTargetNotOpenable, Code.ConcealedByAbstract,
        Code.ConcealedByNotSameRoom, Code.ConcealedByCycle, Code.PowerLoop, Code.ControlLoop, Code.InPartHolderMismatch,
        Code.InPartUnknownPart, Code.InPartUnavailable, Code.GripOccupied, Code.ClosingWithoutClose, Code.CameraWithoutFacing,
        Code.PartContentsTooLarge, Code.ContainerContentsTooLarge, Code.InvalidTrait, Code.BeatInPast, Code.DuplicateBeat,
        Code.TooManyBeats, Code.NoSuchBeat, Code.InvalidBeat, Code.UndeclaredProp, Code.WrongPropType, Code.UnmetRequires, Code.NoRun,
        Code.RunNotRegistering, Code.RunNotRunning, Code.NoSuchSlot, Code.SlotTaken, Code.HandleTaken, Code.RoleForbidden,
        Code.NoSuchPoolBeat, Code.NotSteerable, Code.OutOfRange,
    ];

    private static readonly HashSet<string> OverrideKeys =
    [
        "name", "aliases", "location", "support", "contained_in", "in_part", "concealed_by", "pos", "detached_from",
        "integrity", "status", "residue", "modifiers", "props", "traits", "clear",
    ];

    // A field the edit names: Value is what it names, null for a field named in `clear`. An absent field is no Given.
    public sealed record Given<T>(T? Value);

    public abstract record WorldEdit;
    // A spawn: the template, whether the location was named (Given, so a cleared one is kept apart from none), the
    // overrides as the spawn takes them, and whether any modifier was named (which is never allowed at a spawn).
    public sealed record SpawnEdit(string Template, Given<string>? Location, Spawn.Overrides Fields, bool HasModifiers) : WorldEdit;
    private sealed record SetSeedEdit(long Seed) : WorldEdit;
    private sealed record RemoveEdit(string Target) : WorldEdit;
    // A place: each relation as the edit names it (Given, so a cleared one is kept apart from none), and the position as
    // a plain position or as an offset from an anchor, which is resolved to a plain position before any rule reads it.
    private sealed record PlaceEdit(string Target, Given<string>? Support, Given<string>? ContainedIn, Given<string>? InPart, Given<string>? ConcealedBy, Given<Pos>? Pos, AnchorOffset? Anchor = null) : WorldEdit;
    private sealed record AnchorOffset(string Anchor, long Dx, long Dy);
    private sealed record RefineEdit(string Target, string Template) : WorldEdit;
    // The author's beat edits (src/engine/verbs/edit.ts): a beat to schedule, its action held as the value written; a beat to cancel; and
    // a beat to move to another tick.
    private sealed record ScheduleBeatEdit(BeatCause Beat) : WorldEdit;
    private sealed record CancelBeatEdit(string Id) : WorldEdit;
    private sealed record RetimeBeatEdit(string Id, long AtTick) : WorldEdit;
    // The run and role edits (src/engine/verbs/edit.ts): a registration, a pool beat played at a tick, a door's odds steered,
    // and the run started or ended by the author or a director.
    private sealed record RegisterEdit(string Handle, string Slot) : WorldEdit;
    private sealed record PlayBeatEdit(string Id, long AtTick) : WorldEdit;
    private sealed record SteerEdit(string Entity, long Value) : WorldEdit;
    private sealed record StartRunEdit : WorldEdit;
    private sealed record EndRunEdit : WorldEdit;
    private sealed record PropsEdit(string Kind, string Target, Value.Map Props) : WorldEdit;
    private sealed record SetPartEdit(string Target, string Part, PartState State) : WorldEdit;

    private static Pipeline.Refusal Invalid(Code code) => new(Status.Invalid, code);

    private static Pipeline.Refusal Refused(Code code) => new(Status.Refused, code);

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var command = context.Command;
        if (command.Actor != Resolve.WorldAuthor)
        {
            return Invalid(Code.InvalidAuthor);
        }
        var edit = Parse(command.Args);
        if (edit is null)
        {
            return Invalid(Code.InvalidArgs);
        }
        if (command.By is { } by && !RoleMay(by, edit))
        {
            return Refused(Code.RoleForbidden);
        }
        switch (edit)
        {
            case SpawnEdit spawn:
                return context.Target is not null ? Invalid(Code.UnexpectedTarget) : SpawnRefusal(context, spawn);
            case SetSeedEdit:
                return context.Target is null ? null : Invalid(Code.UnexpectedTarget);
            case StartRunEdit:
                return context.Target is null ? RunEditRefusal(context.Snapshot, start: true) : Invalid(Code.UnexpectedTarget);
            case EndRunEdit:
                return context.Target is null ? RunEditRefusal(context.Snapshot, start: false) : Invalid(Code.UnexpectedTarget);
            case RegisterEdit register:
                return context.Target is null ? RegisterRefusal(context.Snapshot, register) : Invalid(Code.UnexpectedTarget);
            case PlayBeatEdit play:
                return context.Target is null ? PlayRefusal(context.Snapshot, play) : Invalid(Code.UnexpectedTarget);
            case SteerEdit steer:
                return context.Target is null ? SteerRefusal(context.Snapshot, steer) : Invalid(Code.UnexpectedTarget);
        }
        // The beats name no target of their own: they are scheduled, cancelled or moved as a whole.
        if (edit is ScheduleBeatEdit or CancelBeatEdit or RetimeBeatEdit)
        {
            return context.Target is not null ? Invalid(Code.UnexpectedTarget) : BeatRefusal(context, edit);
        }
        var targetId = TargetOf(edit);
        if (context.Target is null || context.Target.Part is not null || context.Target.EntityId != targetId)
        {
            return Invalid(Code.MismatchedTarget);
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
                : Invalid(Code.UnknownTemplate),
            _ => throw new InvalidOperationException("Unknown edit"),
        };
    }

}
