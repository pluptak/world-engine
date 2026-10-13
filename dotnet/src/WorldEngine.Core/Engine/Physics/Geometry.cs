using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Positions, heights and clearances (src/engine/geometry.ts): where things stand on their supports, how far
// they slide, what an agent's walk meets, and what a gap lets through. Coordinates are whole centimetres;
// footprints are compared on doubled coordinates so odd sizes stay whole.
public static class Geometry
{
    // What is lower than this is stepped over or stood on, never in the way of feet.
    public const long StepOverCm = 20;

    public sealed record Sweep(long Distance, string? Obstacle);

    public abstract record WalkStop;

    public sealed record OutOfBounds : WalkStop;

    public sealed record Blocked(string With) : WalkStop;

    public sealed record GapStop(string With, long SizeCm, long GapCm);

    public static long Elevation(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string id)
    {
        var visiting = new HashSet<string>(StringComparer.Ordinal);
        long Resolve(string currentId)
        {
            if (!visiting.Add(currentId))
            {
                throw new InvalidOperationException($"Support or containment cycle at {currentId}");
            }
            var entity = RequireEntity(snapshot, currentId);
            long result;
            if (entity.ContainedIn is not null)
            {
                result = Resolve(entity.ContainedIn);
            }
            else if (entity.Support is null)
            {
                result = 0;
            }
            else
            {
                var support = RequireEntity(snapshot, entity.Support);
                var supportElevation = Resolve(support.Id);
                result = support.Template == "room"
                    ? 0
                    : supportElevation + RequireTemplate(registry, support.Template).SizeCm.H;
            }
            visiting.Remove(currentId);
            return result;
        }

        return Resolve(id);
    }

    public static Pos? EffectivePos(Snapshot snapshot, string id)
    {
        var visiting = new HashSet<string>(StringComparer.Ordinal);
        Pos? Resolve(string currentId)
        {
            if (!visiting.Add(currentId))
            {
                throw new InvalidOperationException($"Support or containment cycle at {currentId}");
            }
            var entity = RequireEntity(snapshot, currentId);
            if (entity.Pos is { } pos)
            {
                return pos;
            }

            var parent = entity.ContainedIn ?? entity.Support;
            if (parent is null)
            {
                return null;
            }

            var result = Resolve(parent);
            visiting.Remove(currentId);
            return result;
        }

        return Resolve(id);
    }

    // How far an entity on a support can slide along one axis before its footprint would overlap another's on
    // the same support. A footprint already overlapping the mover never blocks it.
    public static Sweep Slide(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string id,
        string direction,
        long distance,
        Func<string, bool> skip)
    {
        var mover = RequireEntity(snapshot, id);
        var from = EffectivePos(snapshot, id);
        if (from is null || mover.Support is null || mover.ContainedIn is not null)
        {
            return new Sweep(distance, null);
        }
        var size = Footprint(registry, mover.Template);
        var alongX = direction.EndsWith('x');
        var sign = direction.StartsWith('+') ? 1 : -1;
        var result = new Sweep(distance, null);

        foreach (var otherId in snapshot.Entities.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var other = RequireEntity(snapshot, otherId);
            if (otherId == id
                || other.Support != mover.Support
                || other.ContainedIn is not null
                || other.Status == EntityStatus.Destroyed
                // Rubble is passed over: what broke, and what declares itself debris.
                || other.Status == EntityStatus.Broken
                || IsTrue(other.Props.GetValueOrDefault("rubble"))
                || skip(otherId))
            {
                continue;
            }
            var at = EffectivePos(snapshot, otherId);
            if (at is null)
            {
                continue;
            }
            var otherSize = Footprint(registry, other.Template);
            var spanX = size.W + otherSize.W;
            var spanY = size.D + otherSize.D;
            var dx2 = 2 * (at.X - from.X);
            var dy2 = 2 * (at.Y - from.Y);
            if (Math.Abs(dx2) < spanX && Math.Abs(dy2) < spanY)
            {
                continue;
            }
            var across = alongX ? dy2 : dx2;
            if (Math.Abs(across) >= (alongX ? spanY : spanX))
            {
                continue;
            }
            var ahead = sign * (alongX ? dx2 : dy2);
            var gap2 = ahead - (alongX ? spanX : spanY);
            if (gap2 < 0)
            {
                continue;
            }
            // Contact at gap2 / 2; the largest whole distance that still leaves no overlap.
            var free = gap2 / 2;
            if (free < result.Distance)
            {
                result = new Sweep(free, otherId);
            }
        }
        return result;
    }

    // The first refusal of an agent's walk to `to`: outside the room's footprint (a room's origin is its centre),
    // across a barrier on the straight way there, or into anything solid standing at the destination.
    public static WalkStop? WalkStopFor(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string id,
        Pos to,
        bool arriving = false)
    {
        var mover = RequireEntity(snapshot, id);
        var from = EffectivePos(snapshot, id);
        var room = mover.Support is null ? null : snapshot.Entities.GetValueOrDefault(mover.Support);
        if (from is null || room is null || room.Template != "room")
        {
            return null;
        }
        var size = Footprint(registry, mover.Template);
        var bounds = Footprint(registry, room.Template);
        if (2 * Math.Abs(to.X) + size.W > bounds.W || 2 * Math.Abs(to.Y) + size.D > bounds.D)
        {
            return new OutOfBounds();
        }

        var obstacles = WalkObstacles(snapshot, registry, id, arriving);
        var barriers = obstacles.Where(candidate => candidate.Barrier).Select(ToBox).ToList();
        var first = Crossings(from, to, size, barriers).FirstOrDefault();
        if (first is not null)
        {
            return new Blocked(first);
        }

        foreach (var obstacle in obstacles)
        {
            if (2 * Math.Abs(obstacle.At.X - to.X) < size.W + obstacle.W
                && 2 * Math.Abs(obstacle.At.Y - to.Y) < size.D + obstacle.D)
            {
                return new Blocked(obstacle.Id);
            }
        }
        return null;
    }

    // A thing passed between two entities in one room goes straight from one's position to the other's, and every
    // shut barrier on that line must leave a gap it fits: the thing turned edgewise, its smallest dimension at most
    // the barrier's `gap_cm`.
    public static GapStop? GapStopFor(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string thingId,
        string fromId,
        string toId)
    {
        var thing = registry.GetValueOrDefault(RequireEntity(snapshot, thingId).Template);
        var from = EffectivePos(snapshot, fromId);
        var to = EffectivePos(snapshot, toId);
        var room = RequireEntity(snapshot, fromId).Location;
        var sameRoom = room is not null && RequireEntity(snapshot, toId).Location == room;
        if (thing is null || from is null || to is null || !sameRoom)
        {
            return null;
        }

        var barriers = new List<Box>();
        foreach (var id in snapshot.Entities.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var other = RequireEntity(snapshot, id);
            var template = registry.GetValueOrDefault(other.Template);
            var at = EffectivePos(snapshot, id);
            if (template is not null
                && at is not null
                && other.Support == room
                && IsTrue(other.Props.GetValueOrDefault("barrier"))
                && !IsTrue(other.Props.GetValueOrDefault("open")))
            {
                barriers.Add(new Box(id, at, template.SizeCm.W, template.SizeCm.D));
            }
        }

        var size = Math.Min(Math.Min(thing.SizeCm.W, thing.SizeCm.D), thing.SizeCm.H);
        // The hand's line is a centimetre wide, so the seam where two sections meet is no way through.
        foreach (var id in Crossings(from, to, (1, 1), barriers))
        {
            var gapCm = SafeIntegerAbove(RequireEntity(snapshot, id).Props.GetValueOrDefault("gap_cm"), 0);
            if (size > gapCm)
            {
                return new GapStop(id, size, gapCm);
            }
        }
        return null;
    }

    // What a closing gate moves aside: everything standing on its footprint on the same support.
    public static IReadOnlyList<string> OccupantsIn(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string id)
    {
        var entity = RequireEntity(snapshot, id);
        if (entity.Pos is not { } at || entity.Support is null)
        {
            return [];
        }
        var size = Footprint(registry, entity.Template);
        var found = new List<string>();
        foreach (var otherId in snapshot.Entities.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var other = RequireEntity(snapshot, otherId);
            var template = registry.GetValueOrDefault(other.Template);
            if (otherId == id
                || other.Pos is not { } there
                || other.ContainedIn is not null
                || other.Support != entity.Support
                || other.DetachedFrom is not null
                || other.Status == EntityStatus.Destroyed
                || other.Status == EntityStatus.Broken
                || IsTrue(other.Props.GetValueOrDefault("rubble"))
                || template is null
                || IsTrue(template.Props.GetValueOrDefault("abstract"))
                || IsTrue(template.Props.GetValueOrDefault("scenery"))
                || template.SizeCm.H < StepOverCm)
            {
                continue;
            }
            var theirs = Footprint(registry, other.Template);
            var overlaps = 2 * Math.Abs(there.X - at.X) < size.W + theirs.W
                && 2 * Math.Abs(there.Y - at.Y) < size.D + theirs.D;
            if (overlaps)
            {
                found.Add(otherId);
            }
        }
        return found;
    }

    // Where one occupant goes: just clear of the footprint along the gate's thin axis, on the side its centre is
    // on; a tie takes the positive side.
    public static Pos PushAsideDestination(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string gateId, string occupantId)
    {
        var gate = RequireEntity(snapshot, gateId);
        var occupant = RequireEntity(snapshot, occupantId);
        var gateAt = gate.Pos ?? throw new InvalidOperationException($"{gateId} has no position");
        var there = occupant.Pos ?? throw new InvalidOperationException($"{occupantId} has no position");
        var gateSize = Footprint(registry, gate.Template);
        var theirs = Footprint(registry, occupant.Template);
        if (gateSize.W >= gateSize.D)
        {
            var clearance = (gateSize.D + theirs.D + 1) / 2;
            var sign = there.Y > gateAt.Y ? 1 : there.Y < gateAt.Y ? -1 : 1;
            return new Pos(there.X, gateAt.Y + sign * clearance);
        }
        var sideClearance = (gateSize.W + theirs.W + 1) / 2;
        var side = there.X > gateAt.X ? 1 : there.X < gateAt.X ? -1 : 1;
        return new Pos(gateAt.X + side * sideClearance, there.Y);
    }

    private sealed record Obstacle(string Id, Pos At, long W, long D, bool Barrier);

    private sealed record Box(string Id, Pos At, long W, long D);

    private readonly record struct Fraction(long Num, long Den);

    private static Box ToBox(Obstacle obstacle) => new(obstacle.Id, obstacle.At, obstacle.W, obstacle.D);

    // The things an agent's footprint can meet on its own support: what is not stepped over, not an open barrier,
    // and not what it already overlaps where it starts (unless it is arriving from another room).
    private static List<Obstacle> WalkObstacles(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string id, bool arriving)
    {
        var mover = RequireEntity(snapshot, id);
        var from = EffectivePos(snapshot, id);
        if (from is null || mover.Support is null)
        {
            return [];
        }
        var size = Footprint(registry, mover.Template);
        var found = new List<Obstacle>();
        foreach (var otherId in snapshot.Entities.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var other = RequireEntity(snapshot, otherId);
            var template = registry.GetValueOrDefault(other.Template);
            var barrier = IsTrue(other.Props.GetValueOrDefault("barrier"));
            if (otherId == id
                || template is null
                || other.Support != mover.Support
                || other.ContainedIn is not null
                || other.Status == EntityStatus.Destroyed
                || other.Status == EntityStatus.Broken
                || IsTrue(other.Props.GetValueOrDefault("rubble"))
                || IsTrue(template.Props.GetValueOrDefault("abstract"))
                || IsTrue(template.Props.GetValueOrDefault("scenery"))
                || (barrier && IsTrue(other.Props.GetValueOrDefault("open")))
                || (!barrier && template.SizeCm.H < StepOverCm))
            {
                continue;
            }
            var at = EffectivePos(snapshot, otherId);
            if (at is null)
            {
                continue;
            }
            var w = template.SizeCm.W;
            var d = template.SizeCm.D;
            if (!arriving && 2 * Math.Abs(at.X - from.X) < size.W + w && 2 * Math.Abs(at.Y - from.Y) < size.D + d)
            {
                continue;
            }
            found.Add(new Obstacle(otherId, at, w, d, barrier));
        }
        return found;
    }

    // The boxes a straight segment from `from` to `to` enters, carrying a footprint of `size`, in the order it
    // meets them, the lowest id first on a tie. On doubled coordinates the path is S + t·(E − S) for t in [0, 1].
    private static List<string> Crossings(Pos from, Pos to, (long W, long D) size, IReadOnlyList<Box> boxes)
    {
        var sx = 2 * from.X;
        var sy = 2 * from.Y;
        var dx = 2 * (to.X - from.X);
        var dy = 2 * (to.Y - from.Y);
        var met = new List<(string Id, Fraction T)>();
        foreach (var box in boxes)
        {
            var lo = new Fraction(0, 1);
            var hi = new Fraction(1, 1);
            var misses = false;
            foreach (var (start, delta, centre, span) in new[]
            {
                (sx, dx, 2 * box.At.X, size.W + box.W),
                (sy, dy, 2 * box.At.Y, size.D + box.D),
            })
            {
                if (delta == 0)
                {
                    misses = misses || Math.Abs(start - centre) >= span;
                    continue;
                }
                var near = new Fraction(centre - span - start, delta);
                var far = new Fraction(centre + span - start, delta);
                var (enter, leave) = delta > 0 ? (near, far) : (far, near);
                var entering = Positive(enter);
                var leaving = Positive(leave);
                if (Less(lo, entering))
                {
                    lo = entering;
                }
                if (Less(leaving, hi))
                {
                    hi = leaving;
                }
            }
            if (!misses && Less(lo, hi))
            {
                met.Add((box.Id, lo));
            }
        }
        met.Sort((left, right) =>
            Less(left.T, right.T) ? -1
            : Less(right.T, left.T) ? 1
            : string.CompareOrdinal(left.Id, right.Id) < 0 ? -1
            : 1);
        return met.Select(entry => entry.Id).ToList();
    }

    private static bool Less(Fraction a, Fraction b) => a.Num * b.Den < b.Num * a.Den;

    private static Fraction Positive(Fraction f) => f.Den < 0 ? new Fraction(-f.Num, -f.Den) : f;

    private static Entity RequireEntity(Snapshot snapshot, string id) =>
        snapshot.Entities.TryGetValue(id, out var entity)
            ? entity
            : throw new InvalidOperationException($"Unknown entity {id}");

    private static Template RequireTemplate(IReadOnlyDictionary<string, Template> registry, string templateId) =>
        registry.TryGetValue(templateId, out var template)
            ? template
            : throw new InvalidOperationException($"Unknown template {templateId}");

    private static (long W, long D) Footprint(IReadOnlyDictionary<string, Template> registry, string templateId)
    {
        var template = RequireTemplate(registry, templateId);
        return (template.SizeCm.W, template.SizeCm.D);
    }

    private static bool IsTrue(JsonNode? value) =>
        (value as JsonValue)?.GetValueKind() is JsonValueKind.True;

    // A prop that must be a whole number above `floor`, else `floor` itself.
    private static long SafeIntegerAbove(JsonNode? value, long floor)
    {
        var number = PropFields.Number(value);
        return number is { } n && Math.Floor(n) == n && n > floor && n <= 9_007_199_254_740_991
            ? (long)n
            : floor;
    }
}
