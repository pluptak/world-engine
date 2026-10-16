using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What hides under a thing, and the uncovering a move causes (src/engine/verbs/search.ts `hiddenBy` and
// `revealConcealed`). Moving either end of the concealment relation uncovers it: whatever the mover was hiding stops
// being hidden, and the mover stops being hidden. One `revealed` event per entity, caused by the move that did it.
public static class Concealment
{
    // Everything the entity hides, in id order.
    public static IReadOnlyList<string> HiddenBy(Snapshot snapshot, string concealerId) =>
        [.. snapshot.Entities.Keys.Order(StringComparer.Ordinal).Where(id => snapshot.Entities[id].ConcealedBy == concealerId)];

    public static void RevealConcealed(Working working, string moverId, string causeEventId)
    {
        var mover = working.Snapshot.Entities.GetValueOrDefault(moverId);
        var uncovered = HiddenBy(working.Snapshot, moverId)
            .Concat(mover?.ConcealedBy is not null ? [moverId] : [])
            .Order(StringComparer.Ordinal)
            .ToList();
        foreach (var id in uncovered)
        {
            // The event names whatever was doing the hiding, which for the mover is not itself.
            var concealer = working.Snapshot.Entities[id].ConcealedBy;
            var revealed = working.Emit(EventType.Revealed, id, Pipeline.Reason(("concealer", concealer)), causeEventId);
            working.SetRelation(id, "concealed_by", null, revealed);
        }
    }
}
