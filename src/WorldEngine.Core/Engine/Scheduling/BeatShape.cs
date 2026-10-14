using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What a beat may carry (src/engine/beats.ts `parseScheduleBeat` and what it calls): the shape rules over a beat's records, which
// a beat an edit or a scene writes is held to when it is read, and `validateSnapshot` holds a stored beat to.
public static partial class Beats
{
    // `{ all: [...] }` holds when each of its one to MaxAll single conditions does, and the singles are not nested. Otherwise
    // one of three single forms, told apart by their fields.
    private static bool ConditionOk(BeatCondition condition)
    {
        if (condition.All is { } all)
        {
            return condition with { All = null } == new BeatCondition()
                && all.Count > 0
                && all.Count <= MaxAll
                && all.All(SingleOk);
        }
        return SingleOk(condition);
    }

    private static bool SingleOk(BeatCondition condition)
    {
        if (condition.All is not null)
        {
            return false;
        }
        if (condition.In is not null)
        {
            return condition == new BeatCondition(Entity: condition.Entity, In: condition.In) && NonEmpty(condition.Entity) && NonEmpty(condition.In);
        }
        if (condition.Room is not null || condition.Occupied is not null)
        {
            return condition == new BeatCondition(Room: condition.Room, Occupied: condition.Occupied)
                && NonEmpty(condition.Room)
                && condition.Occupied is not null;
        }
        return PropConditionOk(condition);
    }

    // A string, a boolean or a whole number; the ordering ops need a number.
    private static bool PropConditionOk(BeatCondition condition)
    {
        if (!NonEmpty(condition.Entity) || !NonEmpty(condition.Prop) || condition.Op is not { } op || !Ops.Contains(op))
        {
            return false;
        }
        return condition.Value switch
        {
            Value.Int => true,
            Value.Text or Value.Bool => op is "eq" or "ne",
            _ => false,
        };
    }

    // A `repeat`: a run every so many ticks, a number of times after the first, and optionally a watch.
    private static bool RepeatOk(BeatRepeat repeat) =>
        repeat.EveryTicks >= 1 && repeat.Times >= 1 && repeat.Times <= MaxRepeats && repeat.UntilRan is null or true;

    // An action: a sound from an entity, or one of the author's edits.
    private static bool ActionOk(Value.Map? action)
    {
        if (action?.GetValueOrDefault("kind").AsText() is not { } kind)
        {
            return false;
        }
        if (kind == "sound")
        {
            return action.Keys.All(key => key is "kind" or "entity" or "loud")
                && NonEmpty(action.GetValueOrDefault("entity").AsText())
                && action.GetValueOrDefault("loud") is null or Value.Bool;
        }
        return ActionEdits.Contains(kind) && EditVerb.ParsesAsEdit(action) && ActionSubject(action) is not null;
    }

    // The entity a beat is about: a sound's source, an edit's target, a spawn's location. It is the entity the beat goes with
    // if it is removed first.
    public static string? ActionSubject(Value.Map action) => action.GetValueOrDefault("kind").AsText() switch
    {
        "sound" => action.GetValueOrDefault("entity").AsText(),
        "spawn" => (action.GetValueOrDefault("overrides") as Value.Map)?.GetValueOrDefault("location").AsText(),
        _ => action.GetValueOrDefault("target").AsText(),
    };

    // The followers of a beat, nested to MaxDepth.
    private static bool ChildrenOk(IReadOnlyList<BeatFollower> children, int depth)
    {
        if (children.Count == 0 || depth > MaxDepth)
        {
            return false;
        }
        return children.All(child =>
            child is not null
            && IsBeatId(child.Id)
            && child.DelayTicks > 0
            && ActionOk(child.Action)
            && (child.OnlyIf is null || ConditionOk(child.OnlyIf))
            && (child.Then is null || ChildrenOk(child.Then, depth + 1)));
    }

    // Whether a beat's parts are well formed together: its id, its action, and optionally a condition, followers and a repeat,
    // which a beat cannot have with followers (parseScheduleBeat).
    private static bool ShapeOk(string? id, Value.Map? action, BeatCondition? onlyIf, IReadOnlyList<BeatFollower>? then, BeatRepeat? repeat)
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
    public static string? Invalid(BeatCause cause)
    {
        if (!ShapeOk(cause.Id, cause.Action, cause.OnlyIf, cause.Then, cause.Repeat))
        {
            return $"beat {cause.Id} is malformed";
        }
        var subject = ActionSubject(cause.Action);
        return subject == cause.Entity ? null : $"beat {cause.Id} is not about {cause.Entity}";
    }

    // Every id in the pending beats and the chains they will schedule, in schedule order.
    public static List<string> PendingBeatIds(IEnumerable<ScheduledCause> causes) =>
        [.. causes.OfType<BeatCause>().SelectMany(beat => Ids(beat.Id, beat.Then))];
}
