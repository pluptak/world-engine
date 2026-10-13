using System.Text.Json;
using System.Text.Json.Nodes;
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
    public sealed record Given<T>(T? Value);

    public abstract record WorldEdit;
    // A spawn: the template, whether the location was named (Given, so an explicit null is kept apart from none), the
    // overrides as the spawn takes them, and whether any modifier was named (which is never allowed at a spawn).
    public sealed record SpawnEdit(string Template, Given<string>? Location, Spawn.Overrides Fields, bool HasModifiers) : WorldEdit;
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

}
