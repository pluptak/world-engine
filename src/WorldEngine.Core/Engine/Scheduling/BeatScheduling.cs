using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Json;
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

    // The beat a schedule_beat edit makes: due at its tick, about the entity its action names, with no cause until the edit
    // that queues it gives its own event.
    public static BeatCause CauseOf(JsonObject edit) =>
        new(
            JsonReads.SafeInt(edit["at_tick"])!.Value,
            ActionSubject((JsonObject)edit["action"]!)!,
            null,
            JsonReads.Text(edit["id"])!,
            (JsonObject)edit["action"]!.DeepClone(),
            Typed<BeatCondition>(edit["only_if"]),
            Typed<List<BeatFollower>>(edit["then"]),
            Typed<BeatRepeat>(edit["repeat"]));

    // A pool beat from a body its shape rules have passed: as a schedule_beat holds it, less the tick.
    public static PoolBeat PoolBeatOf(JsonObject body) =>
        new(
            JsonReads.Text(body["id"])!,
            (JsonObject)body["action"]!.DeepClone(),
            Typed<BeatCondition>(body["only_if"]),
            Typed<List<BeatFollower>>(body["then"]),
            Typed<BeatRepeat>(body["repeat"]));

    // A played pool beat, due at its tick and caused by the edit that played it.
    public static BeatCause CauseOf(PoolBeat beat, long due, string? causeId) =>
        new(due, ActionSubject(beat.Action)!, causeId, beat.Id, beat.Action, beat.OnlyIf, beat.Then, beat.Repeat);

    // A part of a beat its shape rules have passed, read into its record.
    private static T? Typed<T>(JsonNode? node)
        where T : class => node is null ? null : WorldJson.Read<T>(node);

    // Every id a beat holds: its own, and its followers' and their followers', in order.
    public static IEnumerable<string> Ids(string id, IReadOnlyList<BeatFollower>? then) =>
        [id, .. (then ?? []).SelectMany(child => Ids(child.Id, child.Then))];

    // Every action a beat carries, its followers' included, in the order they are written.
    public static IEnumerable<JsonObject> Actions(JsonObject action, IReadOnlyList<BeatFollower>? then) =>
        [action, .. (then ?? []).SelectMany(child => Actions(child.Action, child.Then))];

    // Every condition a beat carries, its followers' included, in the order they are written.
    public static IEnumerable<BeatCondition> Conditions(BeatCondition? onlyIf, IReadOnlyList<BeatFollower>? then) =>
        [.. onlyIf is null ? [] : new[] { onlyIf }, .. (then ?? []).SelectMany(child => Conditions(child.OnlyIf, child.Then))];

    // The entities an `all` reads: each single condition's room, or its entity.
    public static IEnumerable<string> ConditionSubjects(BeatCondition condition) =>
        (condition.All ?? []).Select(single => single.Room ?? single.Entity!);

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
        var props = Value.Map.Empty;
        foreach (var (name, node) in written)
        {
            // A value that cannot be a prop's (a fraction) is of no prop's type.
            if (!ValueJson.TryFromNode(node, out var value))
            {
                return Code.WrongPropType;
            }
            if (SnapshotValidation.PropValueIssues(template, name, value, []).FirstOrDefault() is { } first)
            {
                return first.Code;
            }
            props = props.With(name, value);
        }
        if (template is null)
        {
            return null;
        }
        // Whether the write changes a definition depends only on the template and the props written.
        var resulting = props.Aggregate(kind == "set_props" ? Value.Map.Empty : subject.Props, (merged, pair) => merged.With(pair.Key, pair.Value));
        return EditVerb.DefinitionWritten(template, resulting) is null ? null : Code.FieldNotEditable;
    }

}
