using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The author's `schedule_beat` edit and what reads the beats an edit carries.
public static partial class Beats
{
    // The beat a schedule_beat edit makes, or null when the edit is not well formed: its keys, its id and tick, and the beat's own
    // shape. It is due at its tick, about the entity its action names, with no cause until the edit that queues it gives its own
    // event.
    public static BeatCause? ScheduleBeatOf(Value.Map edit)
    {
        if (!edit.Keys.All(key => key is "kind" or "id" or "at_tick" or "action" or "only_if" or "then" or "repeat")
            || edit.GetValueOrDefault("at_tick").AsInt() is not { } due
            || !Part<BeatCondition>(edit, "only_if", out var onlyIf)
            || !Part<List<BeatFollower>>(edit, "then", out var then)
            || !Part<BeatRepeat>(edit, "repeat", out var repeat))
        {
            return null;
        }
        var id = edit.GetValueOrDefault("id").AsText();
        var action = edit.GetValueOrDefault("action") as Value.Map;
        return ShapeOk(id, action, onlyIf, then, repeat)
            ? new BeatCause(due, ActionSubject(action!)!, null, id!, action!, onlyIf, then, repeat)
            : null;
    }

    // A condition read into its record, or null when it is not one of the forms a beat may hold.
    public static BeatCondition? ConditionOf(Value value) =>
        ValueJson.TryRead(value, out BeatCondition? condition) && condition is not null && ConditionOk(condition) ? condition : null;

    // Whether a stored condition is one of the forms a beat may hold.
    public static bool IsCondition(BeatCondition condition) => ConditionOk(condition);

    // A pool beat from a beat a schedule_beat would make: as it holds it, less the tick.
    public static PoolBeat PoolBeatOf(BeatCause beat) => new(beat.Id, beat.Action, beat.OnlyIf, beat.Then, beat.Repeat);

    // A played pool beat, due at its tick and caused by the edit that played it.
    public static BeatCause CauseOf(PoolBeat beat, long due, string? causeId) =>
        new(due, ActionSubject(beat.Action)!, causeId, beat.Id, beat.Action, beat.OnlyIf, beat.Then, beat.Repeat);

    // A part of a beat read into its record: true with none when the edit leaves it out, false when it is there and is not one.
    private static bool Part<T>(Value.Map edit, string key, out T? part)
        where T : class
    {
        part = null;
        return edit.GetValueOrDefault(key) is not { } value || ValueJson.TryRead(value, out part);
    }

    // Every id a beat holds: its own, and its followers' and their followers', in order.
    public static IEnumerable<string> Ids(string id, IReadOnlyList<BeatFollower>? then) =>
        [id, .. (then ?? []).SelectMany(child => Ids(child.Id, child.Then))];

    // Every action a beat carries, its followers' included, in the order they are written.
    public static IEnumerable<Value.Map> Actions(Value.Map action, IReadOnlyList<BeatFollower>? then) =>
        [action, .. (then ?? []).SelectMany(child => Actions(child.Action, child.Then))];

    // Every condition a beat carries, its followers' included, in the order they are written.
    public static IEnumerable<BeatCondition> Conditions(BeatCondition? onlyIf, IReadOnlyList<BeatFollower>? then) =>
        [.. onlyIf is null ? [] : new[] { onlyIf }, .. (then ?? []).SelectMany(child => Conditions(child.OnlyIf, child.Then))];

    // The entities an `all` reads: each single condition's room, or its entity.
    public static IEnumerable<string> ConditionSubjects(BeatCondition condition) =>
        (condition.All ?? []).Select(single => single.Room ?? single.Entity!);

    // The code of the first prop a set_props or update_props action would write that its subject's template refuses, or null
    // (src/engine/validate.ts beatPropRefusal). A missing subject is judged where the beat is scheduled, not here.
    public static Code? PropRefusal(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, Value.Map action)
    {
        var kind = action.GetValueOrDefault("kind").AsText();
        if (kind is not ("set_props" or "update_props") || !snapshot.Entities.TryGetValue(action.GetValueOrDefault("target").AsText()!, out var subject))
        {
            return null;
        }
        registry.TryGetValue(subject.Template, out var template);
        var props = action.GetValueOrDefault("props") as Value.Map ?? Value.Map.Empty;
        foreach (var (name, value) in props)
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
        var resulting = props.Aggregate(kind == "set_props" ? Value.Map.Empty : subject.Props, (merged, pair) => merged.With(pair.Key, pair.Value));
        return EditVerb.DefinitionWritten(template, resulting) is null ? null : Code.FieldNotEditable;
    }

}
