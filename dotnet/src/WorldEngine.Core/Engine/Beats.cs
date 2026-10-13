using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Authored beats (src/engine/beats.ts): an intention kept in the schedule as a cause of kind `beat`. When it falls due it
// becomes ordinary events, so every observer senses it as any others. A beat is data: its action is one of a closed set,
// never code. The cause keeps the JSON the snapshot stores; it is read here when it runs, and checked by the same shape rules
// when it is stored.
public static class Beats
{
    // Beats the schedule may hold, counting each follower (src/engine/beats.ts MAX_BEATS).
    public const int MaxBeats = 256;

    // Levels of nesting, the beat itself counted: a beat, its `then`, theirs, and theirs (MAX_DEPTH).
    public const int MaxDepth = 4;

    // Runs a repeating beat may have after its first (MAX_REPEATS).
    public const int MaxRepeats = 1000;

    // Single conditions one `all` holds: from one to this many (MAX_ALL).
    public const int MaxAll = 16;

    private const long MaxSafeInteger = 9007199254740991;

    private static readonly Regex BeatIdPattern = new("^[A-Za-z0-9_.:-]{1,64}\\z", RegexOptions.CultureInvariant);
    private static readonly HashSet<string> Ops = new(StringComparer.Ordinal) { "eq", "ne", "lt", "lte", "gt", "gte" };
    private static readonly HashSet<string> ActionEdits = new(StringComparer.Ordinal)
    {
        "spawn", "remove", "place", "set_props", "update_props", "set_part",
    };

    // What firing a beat did: the edit's first event, or the failure that stopped it with nothing written.
    private abstract record Fired;

    private sealed record Done(string? EventId) : Fired;

    private sealed record Failed(string Code) : Fired;

    // ---- Shape: what a stored beat may carry (parseScheduleBeat and what it calls). ----

    public static bool IsBeatId(string? id) => id is not null && BeatIdPattern.IsMatch(id);

    // A number that is a whole number within the safe range, as `Number.isSafeInteger` reads it; null otherwise.
    private static long? SafeInt(JsonNode? node) =>
        PropFields.Number(node) is { } number && Math.Floor(number) == number && Math.Abs(number) <= MaxSafeInteger
            ? (long)number
            : null;

    private static bool IsSafeInteger(long value) => Math.Abs(value) <= MaxSafeInteger;

    private static string? TextOf(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    private static bool NonEmpty(JsonNode? node) => TextOf(node) is { Length: > 0 };

    private static bool IsBool(JsonNode? node) => node is JsonValue value && value.TryGetValue(out bool _);

    private static bool? BoolOf(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out bool flag) ? flag : null;

    private static bool OnlyKeys(JsonObject obj, params string[] allowed) => obj.All(pair => allowed.Contains(pair.Key));

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

    // ---- Conditions: whether one holds on the snapshot now. ----

    // Whether a well-formed condition holds (src/engine/beats.ts `holds`).
    public static bool Holds(JsonNode condition, Snapshot snapshot)
    {
        var obj = (JsonObject)condition;
        if (obj.ContainsKey("all"))
        {
            return ((JsonArray)obj["all"]!).All(single => SingleHolds(single!, snapshot));
        }
        return SingleHolds(obj, snapshot);
    }

    private static bool SingleHolds(JsonNode node, Snapshot snapshot)
    {
        var obj = (JsonObject)node;
        if (obj.ContainsKey("in"))
        {
            // A room that is not there holds nothing, so asking after it needs no check of its own.
            return snapshot.Entities.TryGetValue(TextOf(obj["entity"])!, out var subject) && subject.Location == TextOf(obj["in"]);
        }
        if (obj.ContainsKey("room"))
        {
            var room = TextOf(obj["room"])!;
            return snapshot.Entities.ContainsKey(room) && Occupied(snapshot, room) == BoolOf(obj["occupied"]);
        }
        if (!snapshot.Entities.TryGetValue(TextOf(obj["entity"])!, out var entity)
            || !entity.Props.TryGetValue(TextOf(obj["prop"])!, out var have))
        {
            return false;
        }
        var want = obj["value"];
        var op = TextOf(obj["op"])!;
        switch (op)
        {
            case "eq":
                return PropFields.SameValue(have, want);
            case "ne":
                return !PropFields.SameValue(have, want);
            default:
                return PropFields.Number(have) is { } left
                    && PropFields.Number(want) is { } right
                    && OrderOps.Holds(op, left, right);
        }
    }

    // Whether a live agent stands in the room: a destroyed body, a bled-out one and a severed part do not.
    private static bool Occupied(Snapshot snapshot, string room) =>
        snapshot.Entities.Values.Any(entity => entity.Location == room && Reach.IsAgent(snapshot, entity.Id));

    // ---- Scheduling: the author's schedule_beat edit (src/engine/beats.ts, src/engine/verbs/edit.ts). ----

    // Whether a schedule_beat edit is well formed: its keys, its id and tick, and the beat's own shape. A condition, followers or
    // repeat that is present must have a value; a null is not one.
    public static bool ParseScheduleBeat(JsonObject edit)
    {
        if (!OnlyKeys(edit, "kind", "id", "at_tick", "action", "only_if", "then", "repeat") || SafeInt(edit["at_tick"]) is null)
        {
            return false;
        }
        if (edit.Any(pair => (pair.Key is "only_if" or "then" or "repeat") && pair.Value is null))
        {
            return false;
        }
        return ShapeOk(TextOf(edit["id"]), edit["action"], edit["only_if"], edit["then"], edit["repeat"]);
    }

    // The beat a schedule_beat edit makes: due at its tick, about the entity its action names, caused by the edit's own event.
    public static ScheduledCause CauseOf(JsonObject edit, string? causeId) =>
        new(
            SafeInt(edit["at_tick"])!.Value,
            "beat",
            ActionSubject((JsonObject)edit["action"]!)!,
            causeId,
            Id: TextOf(edit["id"]),
            Action: edit["action"]!.DeepClone(),
            OnlyIf: edit["only_if"]?.DeepClone(),
            Then: edit["then"]?.DeepClone(),
            Repeat: edit["repeat"]?.DeepClone());

    // Every id the edit's beat would hold: its own, and its followers' and their followers', in order.
    public static List<string> EditIds(JsonObject edit)
    {
        var ids = new List<string>();
        NodeIds(TextOf(edit["id"])!, edit["then"], ids);
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
        ((JsonArray)((JsonObject)condition)["all"]!)
            .Select(single => (JsonObject)single!)
            .Select(single => TextOf(single.ContainsKey("room") ? single["room"] : single["entity"])!)
            .ToList();

    // The code of the first prop a set_props or update_props action would write that its subject's template refuses, or null
    // (src/engine/validate.ts beatPropRefusal). A missing subject is judged where the beat is scheduled, not here.
    public static string? PropRefusal(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, JsonObject action)
    {
        var kind = TextOf(action["kind"]);
        if (kind is not ("set_props" or "update_props") || !snapshot.Entities.TryGetValue(TextOf(action["target"])!, out var subject))
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
        return EditVerb.DefinitionWritten(template, resulting) is null ? null : "field_not_editable";
    }

    // ---- Running a due beat. ----

    // A watch (a repeating beat with `until_ran`) records nothing while its condition is false, and ends after the first run
    // whose action ran; a failed run is still recorded and the watch goes on (src/engine/beats.ts `runBeat`).
    public static void Run(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause)
    {
        var watch = cause.Repeat is JsonObject repeat && PropFields.IsTrue(repeat["until_ran"]);
        if (cause.OnlyIf is not null && !Holds(cause.OnlyIf, working.Snapshot))
        {
            if (!watch)
            {
                Skipped(working, cause, ("reason", "condition"));
            }
        }
        else
        {
            switch (Fire(working, registry, cause))
            {
                case Failed failed:
                    Skipped(working, cause, ("reason", "failed"), ("code", failed.Code));
                    break;
                case Done done:
                    ScheduleFollowers(working, cause.Then as JsonArray, done.EventId);
                    if (watch)
                    {
                        return;
                    }
                    break;
            }
        }
        ScheduleNextRun(working, cause);
    }

    private static void Skipped(Working working, ScheduledCause cause, params (string Key, string Value)[] data)
    {
        var fields = new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["id"] = JsonValue.Create(cause.Id) };
        foreach (var (key, value) in data)
        {
            fields[key] = JsonValue.Create(value);
        }
        working.Emit("beat_skipped", cause.Entity, fields, cause.CauseId);
    }

    private static Fired Fire(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause)
    {
        var action = (JsonObject)cause.Action!;
        if (TextOf(action["kind"]) == "sound")
        {
            var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["loud"] = JsonValue.Create(PropFields.IsTrue(action["loud"])) };
            return new Done(working.Emit("sounded", TextOf(action["entity"])!, data, cause.CauseId));
        }
        return FireEdit(working, registry, cause, action);
    }

    // An edit runs under the beat's own cause, as the author's `edit` would, with the verb's own checks; a failure puts back
    // everything it wrote (the snapshot, the events and the deltas), and the snapshot-wide guard runs after it.
    private static Fired FireEdit(Working working, IReadOnlyDictionary<string, Template> registry, ScheduledCause cause, JsonObject action)
    {
        var targetText = TextOf(action["target"]);
        Resolve.TargetAddress? target = null;
        if (targetText is not null)
        {
            var resolution = Resolve.ResolveTarget(working.Snapshot, registry, Resolve.WorldAuthor, targetText);
            if (resolution is not Resolve.Resolved resolved)
            {
                return new Failed(resolution is Resolve.Ambiguous ? "ambiguous" : "unresolved");
            }
            target = resolved.Target;
        }
        var command = new Command(
            working.CommandId,
            Resolve.WorldAuthor,
            "edit",
            targetText,
            new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["edit"] = action.DeepClone() });
        var context = new Pipeline.CommandContext(working.Snapshot, registry, command, target, EditVerb.Edit.Requires ?? []);
        if (EditVerb.Edit.Preconditions?.Invoke(context) is { } refused)
        {
            return new Failed(CodeOf(refused));
        }

        var mark = working.Mark();
        EditVerb.Edit.Transition?.Invoke(working, context, cause.CauseId);
        // The removal of a subject takes its other pending causes with it before the result is checked, as it does for an
        // edit the author sends.
        Schedule.Prune(working);
        if (EditVerb.Edit.ValidateResult?.Invoke(context with { Snapshot = working.Snapshot }) is { } guard)
        {
            working.Rollback(mark);
            return new Failed(CodeOf(guard));
        }
        return new Done(working.Events.Count > mark.Events ? working.Events[mark.Events].EventId : cause.CauseId);
    }

    private static string CodeOf(Pipeline.Refusal refusal) =>
        refusal.ReasonCode ?? refusal.Status.ToString().ToLowerInvariant();

    // Each follower is scheduled `delay_ticks` after its parent ran, with the parent's event as its cause. One whose subject is
    // gone, or whose due tick is out of range, is not scheduled.
    private static void ScheduleFollowers(Working working, JsonArray? children, string? parentEvent)
    {
        if (children is null)
        {
            return;
        }
        foreach (var raw in children)
        {
            var child = (JsonObject)raw!;
            var due = working.Snapshot.Tick + SafeInt(child["delay_ticks"])!.Value;
            var subject = ActionSubject((JsonObject)child["action"]!);
            if (subject is null || !working.Snapshot.Entities.ContainsKey(subject) || !IsSafeInteger(due))
            {
                continue;
            }
            Schedule.Add(
                working,
                new ScheduledCause(
                    due,
                    "beat",
                    subject,
                    parentEvent,
                    Id: TextOf(child["id"]),
                    Action: child["action"]!.DeepClone(),
                    OnlyIf: child["only_if"]?.DeepClone(),
                    Then: child["then"]?.DeepClone()));
        }
    }

    // The next run of a repeating beat, whatever this one did: it ran, was skipped by its condition, or was refused. It keeps the
    // id, and the cause of the run before it; the run after the last carries no repeat.
    private static void ScheduleNextRun(Working working, ScheduledCause cause)
    {
        if (cause.Repeat is not JsonObject repeat)
        {
            return;
        }
        var due = working.Snapshot.Tick + SafeInt(repeat["every_ticks"])!.Value;
        if (!working.Snapshot.Entities.ContainsKey(cause.Entity) || !IsSafeInteger(due))
        {
            return;
        }
        var times = SafeInt(repeat["times"])!.Value;
        var next = cause with
        {
            DueTick = due,
            Repeat = times > 1 ? WithTimes(repeat, times - 1) : null,
        };
        Schedule.Add(working, next);
    }

    private static JsonObject WithTimes(JsonObject repeat, long times)
    {
        var copy = (JsonObject)repeat.DeepClone();
        copy["times"] = JsonValue.Create(times);
        return copy;
    }
}
