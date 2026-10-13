using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Where a thing is placed, and what follows a placement change (src/resolvers/physical.ts `placementOf` and `fitting`,
// src/engine/validate.ts `derivedLocationOf`, src/engine/verbs/address.ts `subtreeOf` and `refreshSubtreeLocations`).
// A thing held by a holder stands where the holder stands.
public sealed record Placement(string? Support, string? ContainedIn, string? Location, Pos? Pos);

public static class Placements
{
    public static Placement PlacementOf(Snapshot snapshot, Entity entity)
    {
        var holder = entity.InPart is null || entity.ContainedIn is null
            ? null
            : snapshot.Entities.GetValueOrDefault(entity.ContainedIn);
        if (holder is not null)
        {
            return PlacementOf(snapshot, holder);
        }
        return new Placement(entity.Support, entity.ContainedIn, entity.Location, entity.Pos);
    }

    // Where a thing of the given size goes when it stood at `at`: there, unless that is a container it does not fit in,
    // in which case beside the container (where that stands, in turn).
    public static Placement Fitting(Snapshot snapshot, Placement at, Dimensions size)
    {
        var holder = at.ContainedIn is null ? null : snapshot.Entities.GetValueOrDefault(at.ContainedIn);
        var inner = holder is null ? null : Fit.InnerDimensions(holder.Props);
        if (holder is null || inner is null || Fit.Misfit([size.W, size.D, size.H], inner) is null)
        {
            return at;
        }
        return Fitting(snapshot, PlacementOf(snapshot, holder), size);
    }

    // The room a thing is in, read through its containment and support chain. Returns false when the chain is broken
    // (a cycle or a missing entity), which the callers leave alone; a chain that reaches no room gives null.
    public static bool DerivedLocationOf(Snapshot snapshot, string? support, string? containedIn, out string? location)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = containedIn ?? support;
        while (current is not null)
        {
            if (!visited.Add(current))
            {
                location = null;
                return false;
            }
            if (!snapshot.Entities.TryGetValue(current, out var entity))
            {
                location = null;
                return false;
            }
            if (entity.Template == TemplateIds.Room)
            {
                location = entity.Id;
                return true;
            }
            current = entity.ContainedIn ?? entity.Support;
        }
        location = null;
        return true;
    }

    // The root and everything held or supported under it, transitively, in id order.
    public static IReadOnlyList<string> SubtreeOf(Snapshot snapshot, string rootId)
    {
        var members = new HashSet<string>(StringComparer.Ordinal) { rootId };
        var frontier = new List<string> { rootId };
        while (frontier.Count > 0)
        {
            var next = new List<string>();
            foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
            {
                if (members.Contains(id))
                {
                    continue;
                }
                var entity = snapshot.Entities[id];
                if ((entity.Support is not null && members.Contains(entity.Support))
                    || (entity.ContainedIn is not null && members.Contains(entity.ContainedIn)))
                {
                    members.Add(id);
                    next.Add(id);
                }
            }
            frontier = next;
        }
        return [.. members.Order(StringComparer.Ordinal)];
    }

    // Brings the location of a moved subtree up to date with where its members now are.
    public static void RefreshSubtreeLocations(Working working, string rootId, string eventId)
    {
        foreach (var id in SubtreeOf(working.Snapshot, rootId))
        {
            var entity = working.Snapshot.Entities[id];
            if (DerivedLocationOf(working.Snapshot, entity.Support, entity.ContainedIn, out var expected))
            {
                working.SetRelation(id, "location", expected, eventId);
            }
        }
    }
}
