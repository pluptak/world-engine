using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The two links a device may have, each a prop naming one entity (src/engine/power.ts). Loops are refused by
// the snapshot check; the walks still stop at one, so a bad snapshot cannot hang them.
public static class Power
{
    // The ids along one prop from an entity, the entity included, stopping at a missing entity or a repeat.
    public static List<string> Walk(Snapshot snapshot, string id, string prop)
    {
        var path = new List<string>();
        string? current = id;
        while (current is not null && !path.Contains(current))
        {
            if (!snapshot.Entities.TryGetValue(current, out var entity))
            {
                break;
            }
            path.Add(current);
            current = PropValues.GetString(entity.Props, prop);
        }
        return path;
    }

    // Power reaches an entity when every link from it to a source, itself included, is not destroyed nor switched
    // off, and the walk ends at a `power_source` that has no source of its own.
    public static bool Powered(Snapshot snapshot, string id)
    {
        var links = Walk(snapshot, id, "powered_by").Select(link => snapshot.Entities[link]).ToList();
        if (links.Count == 0)
        {
            return false;
        }
        var last = links[^1];
        return PropValues.IsTrue(last.Props, "power_source")
            && PropValues.GetString(last.Props, "powered_by") is null
            && links.All(link => link.Status != EntityStatus.Destroyed && !PropValues.IsFalse(link.Props, "on"));
    }

    // The agent at the end of an entity's `controlled_by` walk, whatever state the links are in.
    public static string? Controller(Snapshot snapshot, string id)
    {
        var path = Walk(snapshot, id, "controlled_by");
        if (path.Count < 2)
        {
            return null;
        }
        var last = snapshot.Entities[path[^1]];
        return PropValues.IsTrue(last.Props, "agent") && PropValues.GetString(last.Props, "controlled_by") is null
            ? last.Id
            : null;
    }

    // The first link from the device toward its controller, the device included and the controller not, that cannot
    // carry a command: a destroyed one, then one with no power.
    public static RemoteFault? RemoteFaultOf(Snapshot snapshot, string device)
    {
        var links = Walk(snapshot, device, "controlled_by");
        return FaultOn(snapshot, links.Take(links.Count - 1));
    }

    // The panel an actor works a device through, for an actor that is not the device's controller and cannot reach
    // the device by hand: the nearest intact panel on the device's control walk, from the device, that the actor
    // can reach. Null when there is none or the walk ends at no agent.
    public static string? PanelFor(Snapshot snapshot, string device, string actor)
    {
        if (Controller(snapshot, device) is null)
        {
            return null;
        }
        var path = Walk(snapshot, device, "controlled_by");
        return path.Skip(1).Take(Math.Max(0, path.Count - 2)).FirstOrDefault(id =>
        {
            var entity = snapshot.Entities[id];
            return PropValues.IsTrue(entity.Props, "panel")
                && entity.Status != EntityStatus.Destroyed
                && Reach.InReach(snapshot, actor, id);
        });
    }

    // The devices of one kind (`camera` or `intercom`) whose feed reaches the observer now: each one not destroyed,
    // its control walk ending at the observer and carrying a command, in id order.
    public static List<string> Feeds(Snapshot snapshot, string observer, string kind) =>
        snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .Where(id =>
            {
                var device = snapshot.Entities[id];
                return PropValues.IsTrue(device.Props, kind)
                    && device.Status != EntityStatus.Destroyed
                    && Controller(snapshot, id) == observer
                    && RemoteFaultOf(snapshot, id) is null;
            })
            .ToList();

    private static RemoteFault? FaultOn(Snapshot snapshot, IEnumerable<string> links)
    {
        foreach (var link in links)
        {
            if (snapshot.Entities[link].Status == EntityStatus.Destroyed)
            {
                return new Disconnected(link);
            }
            if (!Powered(snapshot, link))
            {
                return new Unpowered(link, CutOf(snapshot, link));
            }
        }
        return null;
    }

    // Where power stops for a link with none: the first destroyed or switched-off entity on its `powered_by` walk,
    // else the walk's last entity.
    private static string CutOf(Snapshot snapshot, string link)
    {
        var path = Walk(snapshot, link, "powered_by");
        return path.FirstOrDefault(id =>
        {
            var entity = snapshot.Entities[id];
            return entity.Status == EntityStatus.Destroyed || PropValues.IsFalse(entity.Props, "on");
        }) ?? path[^1];
    }
}

public abstract record RemoteFault;

public sealed record Disconnected(string At) : RemoteFault;

public sealed record Unpowered(string At, string Cut) : RemoteFault;
