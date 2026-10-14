using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The author's `schedule_beat` edit and what reads the beats an edit carries.
public static partial class Beats
{

    // Whether a schedule_beat edit is well formed: its keys, its id and tick, and the beat's own shape. A condition, followers or
    // repeat that is present must have a value; a null is not one.
    public static bool ParseScheduleBeat(JsonObject edit)
    {
        if (!OnlyKeys(edit, "kind", "id", "at_tick", "action", "only_if", "then", "repeat") || JsonReads.SafeInt(edit["at_tick"]) is null)
        {
            return false;
        }
        if (edit.Any(pair => (pair.Key is "only_if" or "then" or "repeat") && pair.Value is null))
        {
            return false;
        }
        return ShapeOk(JsonReads.Text(edit["id"]), edit["action"], edit["only_if"], edit["then"], edit["repeat"]);
    }

    // The beat a schedule_beat edit makes: due at its tick, about the entity its action names, caused by the edit's own event.
    public static ScheduledCause CauseOf(JsonObject edit, string? causeId) =>
        new(
            JsonReads.SafeInt(edit["at_tick"])!.Value,
            CauseKind.Beat,
            ActionSubject((JsonObject)edit["action"]!)!,
            causeId,
            Id: JsonReads.Text(edit["id"]),
            Action: edit["action"]!.DeepClone(),
            OnlyIf: edit["only_if"]?.DeepClone(),
            Then: edit["then"]?.DeepClone(),
            Repeat: edit["repeat"]?.DeepClone());

    // Every id the edit's beat would hold: its own, and its followers' and their followers', in order.
    public static List<string> EditIds(JsonObject edit)
    {
        var ids = new List<string>();
        NodeIds(JsonReads.Text(edit["id"])!, edit["then"], ids);
        return ids;
    }

    // Every action a beat carries, its followers' included, in the order they are written.
    public static List<JsonObject> EditActions(JsonObject beat)
    {
        var found = new List<JsonObject> { (JsonObject)beat["action"]! };
        VisitActions(beat["then"], found);
        return found;
    }

    private static void VisitActions(JsonNode? then, List<JsonObject> found)
    {
        if (then is not JsonArray children)
        {
            return;
        }
        foreach (var child in children.OfType<JsonObject>())
        {
            found.Add((JsonObject)child["action"]!);
            VisitActions(child["then"], found);
        }
    }

    // Every condition a beat carries, its followers' included, in the order they are written.
    public static List<JsonNode> EditConditions(JsonObject beat)
    {
        var found = new List<JsonNode>();
        if (beat["only_if"] is { } only)
        {
            found.Add(only);
        }
        VisitConditions(beat["then"], found);
        return found;
    }

    private static void VisitConditions(JsonNode? then, List<JsonNode> found)
    {
        if (then is not JsonArray children)
        {
            return;
        }
        foreach (var child in children.OfType<JsonObject>())
        {
            if (child["only_if"] is { } only)
            {
                found.Add(only);
            }
            VisitConditions(child["then"], found);
        }
    }

    // The entities an `all` reads: each single condition's room, or its entity.
    public static List<string> ConditionSubjects(JsonNode condition) =>
        [.. ((JsonArray)((JsonObject)condition)["all"]!)
            .Select(single => (JsonObject)single!)
            .Select(single => JsonReads.Text(single.ContainsKey("room") ? single["room"] : single["entity"])!)];

    // The code of the first prop a set_props or update_props action would write that its subject's template refuses, or null
    // (src/engine/validate.ts beatPropRefusal). A missing subject is judged where the beat is scheduled, not here.
    public static Code? PropRefusal(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, JsonObject action)
    {
        var kind = JsonReads.Text(action["kind"]);
        if (kind is not ("set_props" or "update_props") || !snapshot.Entities.TryGetValue(JsonReads.Text(action["target"])!, out var subject))
        {
            return null;
        }
        registry.TryGetValue(subject.Template, out var template);
        var written = action["props"] as JsonObject ?? new JsonObject();
        foreach (var (name, value) in written)
        {
            if (SnapshotValidation.PropValueIssues(template, name, value, []).FirstOrDefault() is { } first)
            {
                return first.Code;
            }
        }
        if (template is null)
        {
            return null;
        }
        // Whether the write changes a definition depends only on the template and the props written.
        var resulting = kind == "set_props"
            ? new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
            : new Dictionary<string, JsonNode?>(subject.Props, StringComparer.Ordinal);
        foreach (var (name, value) in written)
        {
            resulting[name] = value?.DeepClone();
        }
        return EditVerb.DefinitionWritten(template, resulting) is null ? null : Code.FieldNotEditable;
    }

}
