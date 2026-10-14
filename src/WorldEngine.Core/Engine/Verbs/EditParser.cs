using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// Reading an edit from the command's args, each field as TypeScript's `isEdit` and `isOverrides` read it. An edit empties a field
// by naming it in `clear`; an absent field is one it leaves alone.
public static partial class EditVerb
{
    // Whether a beat's action reads as an edit (src/engine/beats.ts parseAction).
    internal static bool ParsesAsEdit(Value.Map action) => ParseEdit(action) is not null;

    // An edit as a command's args.
    internal static Value.Map EditArgs(Value.Map edit) => Value.Map.Empty.With("edit", edit);

    // Reads the `edit` argument (src/engine/verbs/edit.ts `parseEdit`): null when it is not a well-formed edit.
    private static WorldEdit? Parse(Value.Map? args) =>
        args?.GetValueOrDefault("edit") is Value.Map edit ? ParseEdit(edit) : null;

    private static WorldEdit? ParseEdit(Value.Map obj)
    {
        if (Text(obj.GetValueOrDefault("kind")) is not { } kind)
        {
            return null;
        }
        switch (kind)
        {
            case "spawn":
            {
                if (!Only(obj, "kind", "template", "overrides") || Text(obj.GetValueOrDefault("template")) is not { } template)
                {
                    return null;
                }
                if (obj.GetValueOrDefault("overrides") is null)
                {
                    return new SpawnEdit(template, null, new Spawn.Overrides(), false);
                }
                if (obj.GetValueOrDefault("overrides") is not Value.Map overrides || !overrides.All(pair => OverrideKeys.Contains(pair.Key)))
                {
                    return null;
                }
                return ParseOverrides(template, overrides);
            }
            case "set_seed":
            {
                if (!Only(obj, "kind", "seed") || Int(obj.GetValueOrDefault("seed")) is not { } seed || !Rng.IsState(seed))
                {
                    return null;
                }
                return new SetSeedEdit(seed);
            }
            case "schedule_beat":
            {
                return Beats.ScheduleBeatOf(obj) is { } beat ? new ScheduleBeatEdit(beat) : null;
            }
            case "cancel_beat":
            {
                return Only(obj, "kind", "id") && Text(obj.GetValueOrDefault("id")) is { } cancelled && Beats.IsBeatId(cancelled)
                    ? new CancelBeatEdit(cancelled)
                    : null;
            }
            case "retime_beat":
            {
                return Only(obj, "kind", "id", "at_tick") && Text(obj.GetValueOrDefault("id")) is { } moved && Beats.IsBeatId(moved) && Int(obj.GetValueOrDefault("at_tick")) is { } tick
                    ? new RetimeBeatEdit(moved, tick)
                    : null;
            }
            case "register_player":
            {
                return Only(obj, "kind", "handle", "slot") && Text(obj.GetValueOrDefault("handle")) is { } handle && Beats.IsBeatId(handle)
                    && Text(obj.GetValueOrDefault("slot")) is { } slot
                    ? new RegisterEdit(handle, slot)
                    : null;
            }
            case "play_beat":
            {
                return Only(obj, "kind", "id", "at_tick") && Text(obj.GetValueOrDefault("id")) is { } played && Beats.IsBeatId(played)
                    && Int(obj.GetValueOrDefault("at_tick")) is { } tick
                    ? new PlayBeatEdit(played, tick)
                    : null;
            }
            case "steer":
            {
                return Only(obj, "kind", "entity", "prop", "value") && Text(obj.GetValueOrDefault("entity")) is { } entity
                    && Text(obj.GetValueOrDefault("prop")) == Prop.JamPct && Int(obj.GetValueOrDefault("value")) is { } value
                    ? new SteerEdit(entity, value)
                    : null;
            }
            case "start_run":
                return Only(obj, "kind") ? new StartRunEdit() : null;
            case "end_run":
                return Only(obj, "kind") ? new EndRunEdit() : null;
            case "refine":
            {
                if (!Only(obj, "kind", "target", "template") || Text(obj.GetValueOrDefault("target")) is not { } target || Text(obj.GetValueOrDefault("template")) is not { } template)
                {
                    return null;
                }
                return new RefineEdit(target, template);
            }
            case "remove":
            {
                if (!Only(obj, "kind", "target") || Text(obj.GetValueOrDefault("target")) is not { } target)
                {
                    return null;
                }
                return new RemoveEdit(target);
            }
            case "place":
            {
                if (!Only(obj, "kind", "target", "support", "contained_in", "in_part", "concealed_by", "pos", "clear")
                    || Text(obj.GetValueOrDefault("target")) is not { } target
                    || Clears(obj, "support", "contained_in", "in_part", "concealed_by", "pos") is not { } clears)
                {
                    return null;
                }
                AnchorOffset? anchor = null;
                if (obj.GetValueOrDefault("pos") is Value.Map offset && !IsPlainPos(offset) && IsAnchor(offset))
                {
                    anchor = new AnchorOffset(Text(offset.GetValueOrDefault("anchor"))!, Int(offset.GetValueOrDefault("dx"))!.Value, Int(offset.GetValueOrDefault("dy"))!.Value);
                }
                Given<Pos>? pos = null;
                if (!Ref(obj, clears, "support", out var support)
                    || !Ref(obj, clears, "contained_in", out var containedIn)
                    || !Ref(obj, clears, "in_part", out var inPart)
                    || !Ref(obj, clears, "concealed_by", out var concealedBy)
                    || (anchor is null && !PosField(obj, clears, "pos", out pos)))
                {
                    return null;
                }
                return new PlaceEdit(target, support, containedIn, inPart, concealedBy, pos, anchor);
            }
            case "set_props":
            case "update_props":
            {
                if (!Only(obj, "kind", "target", "props") || Text(obj.GetValueOrDefault("target")) is not { } target
                    || obj.GetValueOrDefault("props") is not Value.Map props || !props.Values.All(IsPrimitive))
                {
                    return null;
                }
                return new PropsEdit(kind, target, props);
            }
            case "afflict":
            {
                if (!Only(obj, "kind", "target", "capacity", "amount", "until") || Text(obj.GetValueOrDefault("target")) is not { } target
                    || Text(obj.GetValueOrDefault("capacity")) is not { } capacity || Int(obj.GetValueOrDefault("amount")) is not { } amount
                    || amount is 0 or < -100 or > 100 || Int(obj.GetValueOrDefault("until")) is not { } until)
                {
                    return null;
                }
                return new AfflictEdit(target, capacity, amount, until);
            }
            case "set_part":
            {
                if (!Only(obj, "kind", "target", "part", "state") || Text(obj.GetValueOrDefault("target")) is not { } target
                    || Text(obj.GetValueOrDefault("part")) is not { } part || obj.GetValueOrDefault("state") is not Value.Map state
                    || !state.Keys.All(key => key is "integrity" or "status" or "bound")
                    || Int(state.GetValueOrDefault("integrity")) is not { } integrity || Text(state.GetValueOrDefault("status")) is not { } status
                    || (state.ContainsKey("bound") && state.GetValueOrDefault("bound") is not Value.Bool))
                {
                    return null;
                }
                var bound = state.GetValueOrDefault("bound") is Value.Bool { Flag: true } ? true : (bool?)null;
                var partStatus = status switch
                {
                    "intact" => PartStatus.Intact,
                    "damaged" => PartStatus.Damaged,
                    "detached" => PartStatus.Detached,
                    "destroyed" => PartStatus.Destroyed,
                    _ => (PartStatus?)null,
                };
                return partStatus is { } value ? new SetPartEdit(target, part, new PartState(integrity, value, bound)) : null;
            }
            default:
                return null;
        }
    }

    // The overrides of a spawn, each field as TypeScript's isOverrides reads it: absent is the blank field, named in `clear` is
    // given as none, and a value the field cannot hold makes the edit malformed (null). A trait that is not a string makes the
    // spawn malformed.
    public static SpawnEdit? ParseOverrides(string template, Value.Map overrides)
    {
        if (Clears(overrides, "location", "support", "contained_in", "in_part", "concealed_by", "pos") is not { } clears)
        {
            return null;
        }
        string? name = null;
        if (overrides.TryGetValue("name", out var named))
        {
            if (Text(named, allowEmpty: true) is not { } given)
            {
                return null;
            }
            name = given;
        }
        if (!Ref(overrides, clears, "location", out var location)
            || !Ref(overrides, clears, "support", out var support)
            || !Ref(overrides, clears, "contained_in", out var containedIn)
            || !Ref(overrides, clears, "concealed_by", out var concealedBy)
            || !PosField(overrides, clears, "pos", out var pos)
            || !Origin(overrides, out var origin)
            || !Integrity(overrides, out var integrity))
        {
            return null;
        }
        // A cleared `in_part` is a part given as none: the spawn does not take a free grip, as an omitted one does.
        string? inPart = null;
        var noPart = clears.Contains("in_part");
        if (overrides.TryGetValue("in_part", out var partValue))
        {
            if (Text(partValue, allowEmpty: true) is not { } part)
            {
                return null;
            }
            inPart = part;
        }
        Value.Map? props = null;
        if (overrides.TryGetValue("props", out var propsValue))
        {
            props = propsValue is Value.Map map && map.Values.All(IsPrimitive) ? map : null;
            if (props is null)
            {
                return null;
            }
        }
        List<string>? aliases = null;
        if (overrides.TryGetValue("aliases", out var aliasesValue))
        {
            aliases = aliasesValue is Value.List list && list.Items.All(item => item is Value.Text)
                ? [.. list.Items.Select(item => item.AsText()!)]
                : null;
            if (aliases is null)
            {
                return null;
            }
        }
        Dictionary<string, string>? traits = null;
        if (overrides.TryGetValue("traits", out var traitsValue))
        {
            traits = traitsValue is Value.Map map && map.Values.All(item => item is Value.Text)
                ? map.ToDictionary(pair => pair.Key, pair => pair.Value.AsText()!, StringComparer.Ordinal)
                : null;
            if (traits is null)
            {
                return null;
            }
        }
        Dictionary<string, long>? residue = null;
        if (overrides.TryGetValue("residue", out var residueValue))
        {
            residue = residueValue is Value.Map map && map.Values.All(item => item is Value.Int)
                ? map.ToDictionary(pair => pair.Key, pair => pair.Value.AsInt()!.Value, StringComparer.Ordinal)
                : null;
            if (residue is null)
            {
                return null;
            }
        }
        EntityStatus? status = null;
        if (overrides.TryGetValue("status", out var statusValue))
        {
            status = statusValue.AsText() switch
            {
                "intact" => EntityStatus.Intact,
                "broken" => EntityStatus.Broken,
                "destroyed" => EntityStatus.Destroyed,
                _ => null,
            };
            if (status is null)
            {
                return null;
            }
        }
        var modifiers = overrides.GetValueOrDefault("modifiers");
        if (modifiers is not null && !Modifiers(modifiers))
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
                Status: status,
                InPart: inPart,
                NoPart: noPart),
            modifiers is Value.List { Items.Length: > 0 });
    }

    // Whether a spawn's modifiers are well formed: a list of records each with a capacity, a whole delta, an optional
    // expiry and a cause. Any modifier at all is refused by the caller; this only says the list is well formed.
    private static bool Modifiers(Value node) =>
        node is Value.List list
        && list.Items.All(modifier =>
            modifier is Value.Map record
            && Text(record.GetValueOrDefault("capacity"), allowEmpty: true) is not null
            && Int(record.GetValueOrDefault("delta")) is not null
            && (!record.ContainsKey("expires_at_tick") || Int(record.GetValueOrDefault("expires_at_tick")) is not null)
            && Text(record.GetValueOrDefault("cause_id")) is not null);

    private static bool Only(Value.Map obj, params string[] allowed) => obj.Keys.All(allowed.Contains);

    // The fields an edit empties by naming them in `clear`. Null when `clear` is not a list of fields it may name, or names one the
    // edit also gives a value.
    private static HashSet<string>? Clears(Value.Map obj, params string[] clearable)
    {
        var clears = new HashSet<string>(StringComparer.Ordinal);
        if (!obj.TryGetValue("clear", out var node))
        {
            return clears;
        }
        if (node is not Value.List names)
        {
            return null;
        }
        foreach (var name in names.Items)
        {
            if (Text(name) is not { } field || !clearable.Contains(field) || obj.ContainsKey(field))
            {
                return null;
            }
            clears.Add(field);
        }
        return clears;
    }

    // A non-empty string, or any string when `allowEmpty`; null for anything else.
    private static string? Text(Value? node, bool allowEmpty = false) =>
        node.AsText() is { } text && (allowEmpty || text.Length > 0) ? text : null;

    private static long? Int(Value? node) => node.AsInt();

    // A reference field that is absent (no Given), cleared (Given none) or an id. False for anything else.
    private static bool Ref(Value.Map obj, HashSet<string> clears, string key, out Given<string>? given)
    {
        given = clears.Contains(key) ? new Given<string>(null) : null;
        if (!obj.TryGetValue(key, out var node))
        {
            return true;
        }
        var id = Text(node);
        given = id is null ? null : new Given<string>(id);
        return id is not null;
    }

    // A position field that is absent, cleared, or a plain position; an anchor form is refused loudly by the caller.
    private static bool PosField(Value.Map obj, HashSet<string> clears, string key, out Given<Pos>? given)
    {
        given = clears.Contains(key) ? new Given<Pos>(null) : null;
        if (!obj.TryGetValue(key, out var node))
        {
            return true;
        }
        if (node is Value.Map plain && IsPlainPos(plain))
        {
            given = new Given<Pos>(new Pos(Int(plain.GetValueOrDefault("x"))!.Value, Int(plain.GetValueOrDefault("y"))!.Value));
            return true;
        }
        return false;
    }

    // The detached_from origin of a spawn: absent, or an entity and a part.
    private static bool Origin(Value.Map obj, out DetachedFrom? origin)
    {
        origin = null;
        if (!obj.TryGetValue("detached_from", out var node))
        {
            return true;
        }
        if (node is not Value.Map record || Text(record.GetValueOrDefault("entity")) is not { } entity || Text(record.GetValueOrDefault("part")) is not { } part)
        {
            return false;
        }
        origin = new DetachedFrom(entity, part);
        return true;
    }

    // The spawn's integrity: absent, or a whole number.
    private static bool Integrity(Value.Map obj, out long? integrity)
    {
        integrity = null;
        if (!obj.TryGetValue("integrity", out var node))
        {
            return true;
        }
        integrity = Int(node);
        return integrity is not null;
    }

    private static bool IsPlainPos(Value.Map obj) =>
        obj.Count == 2 && Int(obj.GetValueOrDefault("x")) is not null && Int(obj.GetValueOrDefault("y")) is not null;

    private static bool IsAnchor(Value.Map obj) =>
        Only(obj, "anchor", "dx", "dy") && Text(obj.GetValueOrDefault("anchor")) is not null
        && Int(obj.GetValueOrDefault("dx")) is not null && Int(obj.GetValueOrDefault("dy")) is not null;

    // A prop's value: a string, a boolean or a whole number.
    private static bool IsPrimitive(Value value) => value is Value.Text or Value.Bool or Value.Int;
}
