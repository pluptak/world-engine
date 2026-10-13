using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What a stored beat may carry (src/engine/beats.ts `parseScheduleBeat` and what it calls): the shape rules over the JSON the
// snapshot stores, which `validateSnapshot` also holds a stored beat to.
public static partial class Beats
{
    // `{ all: [...] }` holds when each of its one to MaxAll single conditions does, and the singles are not nested. Otherwise
    // one of three single forms, told apart by their keys.
    private static bool ConditionOk(JsonNode? node)
    {
        if (node is JsonObject obj && obj.ContainsKey("all"))
        {
            return OnlyKeys(obj, "all")
                && obj["all"] is JsonArray all
                && all.Count > 0
                && all.Count <= MaxAll
                && all.All(SingleOk);
        }
        return SingleOk(node);
    }

    private static bool SingleOk(JsonNode? node)
    {
        if (node is not JsonObject obj)
        {
            return false;
        }
        if (obj.ContainsKey("in"))
        {
            return OnlyKeys(obj, "entity", "in") && NonEmpty(obj["entity"]) && NonEmpty(obj["in"]);
        }
        if (obj.ContainsKey("room") || obj.ContainsKey("occupied"))
        {
            return OnlyKeys(obj, "room", "occupied") && NonEmpty(obj["room"]) && IsBool(obj["occupied"]);
        }
        return PropConditionOk(obj);
    }

    private static bool PropConditionOk(JsonObject obj)
    {
        if (!OnlyKeys(obj, "entity", "prop", "op", "value")
            || !NonEmpty(obj["entity"])
            || !NonEmpty(obj["prop"])
            || TextOf(obj["op"]) is not { } op
            || !Ops.Contains(op))
        {
            return false;
        }
        // A string, a boolean or a number; the ordering ops need a number.
        var operand = obj["value"];
        var number = PropFields.Number(operand) is not null;
        if (TextOf(operand) is null && !IsBool(operand) && !number)
        {
            return false;
        }
        return op is "eq" or "ne" || number;
    }

    // A `repeat`: a run every so many ticks, a number of times after the first, and optionally a watch.
    private static bool RepeatOk(JsonNode? node)
    {
        if (node is not JsonObject obj || !OnlyKeys(obj, "every_ticks", "times", "until_ran"))
        {
            return false;
        }
        if (SafeInt(obj["every_ticks"]) is not { } every || every < 1)
        {
            return false;
        }
        if (SafeInt(obj["times"]) is not { } times || times < 1 || times > MaxRepeats)
        {
            return false;
        }
        return !obj.ContainsKey("until_ran") || BoolOf(obj["until_ran"]) == true;
    }

    // An action: a sound from an entity, or one of the author's edits.
    private static bool ActionOk(JsonNode? node)
    {
        if (node is not JsonObject obj || TextOf(obj["kind"]) is not { } kind)
        {
            return false;
        }
        if (kind == "sound")
        {
            return OnlyKeys(obj, "kind", "entity", "loud")
                && NonEmpty(obj["entity"])
                && (!obj.ContainsKey("loud") || IsBool(obj["loud"]));
        }
        return ActionEdits.Contains(kind) && EditVerb.ParsesAsEdit(obj) && ActionSubject(obj) is not null;
    }

    // The entity a beat is about: a sound's source, an edit's target, a spawn's location. It is the entity the beat goes with
    // if it is removed first.
    public static string? ActionSubject(JsonObject action) => TextOf(action["kind"]) switch
    {
        "sound" => TextOf(action["entity"]),
        "spawn" => action["overrides"] is JsonObject overrides ? TextOf(overrides["location"]) : null,
        _ => TextOf(action["target"]),
    };

    // The followers of a beat, nested to MaxDepth.
    private static bool ChildrenOk(JsonNode? node, int depth)
    {
        if (node is not JsonArray children || children.Count == 0 || depth > MaxDepth)
        {
            return false;
        }
        foreach (var raw in children)
        {
            if (raw is not JsonObject child
                || !OnlyKeys(child, "id", "delay_ticks", "action", "only_if", "then")
                || !IsBeatId(TextOf(child["id"]))
                || SafeInt(child["delay_ticks"]) is not { } delay
                || delay <= 0
                || !ActionOk(child["action"]))
            {
                return false;
            }
            if (child.ContainsKey("only_if") && !ConditionOk(child["only_if"]))
            {
                return false;
            }
            if (child.ContainsKey("then") && !ChildrenOk(child["then"], depth + 1))
            {
                return false;
            }
        }
        return true;
    }

    // Whether a beat's parts are well formed together: its id, its action, and optionally a condition, followers and a repeat,
    // which a beat cannot have with followers (parseScheduleBeat).
    private static bool ShapeOk(string? id, JsonNode? action, JsonNode? onlyIf, JsonNode? then, JsonNode? repeat)
    {
        if (!IsBeatId(id) || !ActionOk(action))
        {
            return false;
        }
        if (onlyIf is not null && !ConditionOk(onlyIf))
        {
            return false;
        }
        if (then is not null && !ChildrenOk(then, 2))
        {
            return false;
        }
        return repeat is null || (RepeatOk(repeat) && then is null);
    }

    // What is wrong with a stored beat cause, or null: its shape, and that its action is about its own entity.
    public static string? Invalid(ScheduledCause cause)
    {
        if (!ShapeOk(cause.Id, cause.Action, cause.OnlyIf, cause.Then, cause.Repeat))
        {
            return $"beat {cause.Id ?? "undefined"} is malformed";
        }
        var subject = ActionSubject((JsonObject)cause.Action!);
        return subject == cause.Entity ? null : $"beat {cause.Id} is not about {cause.Entity}";
    }

    // Every id in the pending beats and the chains they will schedule, in schedule order.
    public static List<string> PendingBeatIds(IEnumerable<ScheduledCause> causes)
    {
        var ids = new List<string>();
        foreach (var cause in causes)
        {
            if (cause.Kind == "beat")
            {
                NodeIds(cause.Id ?? "undefined", cause.Then, ids);
            }
        }
        return ids;
    }

    private static void NodeIds(string id, JsonNode? then, List<string> ids)
    {
        ids.Add(id);
        if (then is JsonArray children)
        {
            foreach (var child in children)
            {
                if (child is JsonObject followed)
                {
                    NodeIds(TextOf(followed["id"]) ?? "undefined", followed["then"], ids);
                }
            }
        }
    }

}
