using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A body under a curse (`docs/possession.md`): the link names the agent in control, and holds until its `lapses_at` tick.
// Derived each time it is asked, so a lapsed curse changes nothing in the snapshot.
public static class Possession
{
    // The possessor of a body, or null when no live curse holds it.
    public static string? Holder(Snapshot snapshot, string body)
    {
        if (!snapshot.Entities.TryGetValue(body, out var entity) || entity.Props.Get(Prop.PossessedBy) is not { } linkId
            || !snapshot.Entities.TryGetValue(linkId, out var link) || link.Status == EntityStatus.Destroyed)
        {
            return null;
        }
        if (link.Props.Get(Prop.Possessor) is not { } possessor || !snapshot.Entities.TryGetValue(possessor, out var agent)
            || agent.Status == EntityStatus.Destroyed || !Reach.IsAgent(snapshot, possessor))
        {
            return null;
        }
        return link.Props.Get(Prop.LapsesAt) is { } lapses && lapses <= snapshot.Tick ? null : possessor;
    }
}
