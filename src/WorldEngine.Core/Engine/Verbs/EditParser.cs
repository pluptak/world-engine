using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// Reading an edit from the command's args, each field as TypeScript's `isEdit` and `isOverrides` read it.
public static partial class EditVerb
{
    // Reads the `edit` argument (src/engine/verbs/edit.ts `parseEdit`): null when it is not a well-formed edit.
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
    // field takes null, and a value the field cannot hold makes the edit malformed (null). A trait that is not a string makes
    // the spawn malformed.
    public static SpawnEdit? ParseOverrides(string template, JsonObject overrides)
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
        // An explicit null `in_part` is a part given as none: the spawn does not take a free grip, as an omitted one does.
        string? inPart = null;
        var noPart = false;
        if (overrides.ContainsKey("in_part"))
        {
            if (overrides["in_part"] is null)
            {
                noPart = true;
            }
            else if (Text(overrides["in_part"], allowEmpty: true) is not { } part)
            {
                return null;
            }
            else
            {
                inPart = part;
            }
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
                InPart: inPart,
                NoPart: noPart),
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

    // A map of trait keys to strings; null when it is not a map or holds a value that is not a string.
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
                return null;
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
        JsonReads.Text(node) is { } text && (allowEmpty || text.Length > 0) ? text : null;

    private static long? Int(JsonNode? node) => JsonReads.SafeInt(node);

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
