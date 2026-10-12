using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The world author's `edit` (src/engine/verbs/edit.ts) for the edits ported so far: spawn, remove, place, set_props,
// update_props, set_part and set_seed. The result is judged by the snapshot invariants, so an edit that would break one
// is refused and nothing is written. The beat, run, role and refine edits, and placements at an anchor, are not ported
// and are refused loudly.
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

    // Kinds the parser knows but this port does not yet carry out.
    private static readonly HashSet<string> UnportedKinds =
    [
        "refine", "schedule_beat", "cancel_beat", "retime_beat", "register_player", "play_beat", "steer", "start_run", "end_run",
    ];

    // Spawn override keys this port does not carry yet; a spawn that names one is refused loudly.
    private static readonly HashSet<string> UnportedOverrides =
    [
        "aliases", "in_part", "concealed_by", "status", "residue", "modifiers", "props", "traits",
    ];

    private static readonly HashSet<string> OverrideKeys =
    [
        "name", "aliases", "location", "support", "contained_in", "in_part", "concealed_by", "pos", "detached_from",
        "integrity", "status", "residue", "modifiers", "props", "traits",
    ];

    // A field the edit names: Value is what it names, null for an explicit null (a clear). An absent field is no Given.
    private sealed record Given<T>(T? Value);

    private abstract record WorldEdit;
    private sealed record SpawnEdit(string Template, string? Name, Given<string>? Location, string? Support, string? ContainedIn, Pos? Pos, long? Integrity, DetachedFrom? DetachedFrom) : WorldEdit;
    private sealed record SetSeedEdit(long Seed) : WorldEdit;
    private sealed record RemoveEdit(string Target) : WorldEdit;
    private sealed record PlaceEdit(string Target, Given<string>? Support, Given<string>? ContainedIn, Given<string>? InPart, Given<string>? ConcealedBy, Given<Pos>? Pos) : WorldEdit;
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
        // Only the author may make these edits (`roleMay`: the directors' edits are the beat and run ones).
        if (command.By is { } by && by.Role != Role.Author)
        {
            return Refused("role_forbidden");
        }
        switch (edit)
        {
            case SpawnEdit spawn:
                return context.Target is not null ? Invalid("unexpected_target") : SpawnRefusal(context, spawn);
            case SetSeedEdit:
                return context.Target is null ? null : Invalid("unexpected_target");
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
            _ => throw new InvalidOperationException("Unknown edit"),
        };
    }

    private static string TargetOf(WorldEdit edit) => edit switch
    {
        RemoveEdit remove => remove.Target,
        PlaceEdit place => place.Target,
        PropsEdit props => props.Target,
        SetPartEdit part => part.Target,
        _ => throw new InvalidOperationException("Edit has no target"),
    };

    private static Pipeline.Refusal? SpawnRefusal(Pipeline.CommandContext context, SpawnEdit edit)
    {
        var snapshot = context.Snapshot;
        if (!context.Registry.ContainsKey(edit.Template))
        {
            return Invalid("unknown_template");
        }
        if (edit.Support is not null && edit.ContainedIn is not null)
        {
            return Refused("conflicting_placement");
        }
        if (Missing(snapshot, edit.Location?.Value) || Missing(snapshot, edit.Support) || Missing(snapshot, edit.ContainedIn))
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
        // A location the chain does not give is a derived field written as something else.
        if (edit.Location is { } given
            && Placements.DerivedLocationOf(snapshot, edit.Support, edit.ContainedIn, out var derived)
            && derived != given.Value)
        {
            return Refused("derived_field");
        }
        if (edit.Support is not null && snapshot.Entities.GetValueOrDefault(edit.Support)?.Template == "room")
        {
            if (edit.Pos is null)
            {
                return Refused("room_support_without_pos");
            }
        }
        else if (edit.Pos is not null)
        {
            return Refused("pos_without_room_support");
        }
        if (edit.DetachedFrom is { } origin)
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
        return Placements.DerivedLocationOf(snapshot, edit.Support, edit.ContainedIn, out var room)
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

    private static Pipeline.Refusal? PlaceRefusal(Pipeline.CommandContext context, PlaceEdit edit, Entity subject)
    {
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
    private static string? DefinitionWritten(Template template, IReadOnlyDictionary<string, JsonNode?> resulting)
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
                working.SpawnUnder(
                    context.Registry,
                    spawn.Template,
                    new Spawn.Overrides(
                        Location: location,
                        Support: spawn.Support,
                        Pos: spawn.Pos,
                        ContainedIn: spawn.ContainedIn,
                        Name: spawn.Name,
                        Integrity: spawn.Integrity,
                        DetachedFrom: spawn.DetachedFrom),
                    rootEventId);
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
        }
    }

    private static void TransitionPlace(Working working, Pipeline.CommandContext context, PlaceEdit edit, string rootEventId)
    {
        var subject = context.Snapshot.Entities[edit.Target];
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
    private static WorldEdit? Parse(IReadOnlyDictionary<string, JsonNode?>? args)
    {
        if (args is null || !args.TryGetValue("edit", out var node) || node is not JsonObject obj || Text(obj["kind"]) is not { } kind)
        {
            return null;
        }
        if (UnportedKinds.Contains(kind))
        {
            throw new NotPortedException($"edit {kind}");
        }
        switch (kind)
        {
            case "spawn":
            {
                if (!Only(obj, "kind", "template", "overrides") || Text(obj["template"]) is not { } template)
                {
                    return null;
                }
                var overrides = obj["overrides"] is null ? new JsonObject() : obj["overrides"] as JsonObject;
                if (overrides is null || !overrides.All(pair => OverrideKeys.Contains(pair.Key)))
                {
                    return null;
                }
                var unported = overrides.Select(pair => pair.Key).FirstOrDefault(UnportedOverrides.Contains);
                if (unported is not null)
                {
                    throw new NotPortedException($"spawn override {unported}");
                }
                if (overrides.Where(pair => pair.Key == "name").Any(pair => Text(pair.Value, allowEmpty: true) is null))
                {
                    return null;
                }
                if (!Ref(overrides, "location", out var location)
                    || !Ref(overrides, "support", out var support)
                    || !Ref(overrides, "contained_in", out var containedIn)
                    || !PosField(overrides, "pos", out var pos)
                    || !Origin(overrides, out var origin)
                    || !Integrity(overrides, out var integrity))
                {
                    return null;
                }
                return new SpawnEdit(
                    template,
                    overrides["name"] is null ? null : Text(overrides["name"], allowEmpty: true),
                    location,
                    support?.Value,
                    containedIn?.Value,
                    pos?.Value,
                    integrity,
                    origin);
            }
            case "set_seed":
            {
                if (!Only(obj, "kind", "seed") || Int(obj["seed"]) is not { } seed || !Rng.IsState(seed))
                {
                    return null;
                }
                return new SetSeedEdit(seed);
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
                if (obj.ContainsKey("pos") && obj["pos"] is JsonObject anchor && !IsPlainPos(anchor))
                {
                    // An anchored position is resolved against the anchor before any rule reads it, which is not ported.
                    if (IsAnchor(anchor))
                    {
                        throw new NotPortedException("place at an anchor");
                    }
                }
                if (!Ref(obj, "support", out var support)
                    || !Ref(obj, "contained_in", out var containedIn)
                    || !Ref(obj, "in_part", out var inPart)
                    || !Ref(obj, "concealed_by", out var concealedBy)
                    || !PosField(obj, "pos", out var pos))
                {
                    return null;
                }
                return new PlaceEdit(target, support, containedIn, inPart, concealedBy, pos);
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
