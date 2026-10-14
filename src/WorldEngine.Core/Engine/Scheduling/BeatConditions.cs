using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// Whether a beat's condition holds on the snapshot now.
public static partial class Beats
{

    // Whether a well-formed condition holds (src/engine/beats.ts `holds`).
    public static bool Holds(BeatCondition condition, Snapshot snapshot) =>
        condition.All is { } all ? all.All(single => SingleHolds(single, snapshot)) : SingleHolds(condition, snapshot);

    private static bool SingleHolds(BeatCondition condition, Snapshot snapshot)
    {
        if (condition.In is { } room)
        {
            // A room that is not there holds nothing, so asking after it needs no check of its own.
            return snapshot.Entities.TryGetValue(condition.Entity!, out var subject) && subject.Location == room;
        }
        if (condition.Room is { } watched)
        {
            return snapshot.Entities.ContainsKey(watched) && Occupied(snapshot, watched) == condition.Occupied;
        }
        if (!snapshot.Entities.TryGetValue(condition.Entity!, out var entity) || !entity.Props.TryGetValue(condition.Prop!, out var have))
        {
            return false;
        }
        var want = condition.Value;
        switch (condition.Op)
        {
            case "eq":
                return Prop.SameValue(have, want);
            case "ne":
                return !Prop.SameValue(have, want);
            default:
                return have is Value.Int left
                    && want is Value.Int right
                    && OrderOps.Holds(condition.Op!, left.Number, right.Number);
        }
    }

    // Whether a live agent stands in the room: a destroyed body, a bled-out one and a severed part do not.
    private static bool Occupied(Snapshot snapshot, string room) =>
        snapshot.Entities.Values.Any(entity => entity.Location == room && Reach.IsAgent(snapshot, entity.Id));

}
