using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The two links a device may have, each a prop naming one entity (src/engine/power.ts). Loops are refused by
// the snapshot check; the walks still stop at one, so a bad snapshot cannot hang them.
public static class Power
{
    // The ids along one prop from an entity, the entity included, stopping at a missing entity or a repeat.
    public static List<string> Walk(Snapshot snapshot, string id, Prop<string> prop)
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
            current = entity.Props.Get(prop);
        }
        return path;
    }

    // Power reaches an entity when every link from it to a source, itself included, is not destroyed nor switched
    // off, and the walk ends at a `power_source` that has no source of its own.
    public static bool Powered(Snapshot snapshot, string id)
    {
        var links = Walk(snapshot, id, Prop.PoweredBy).Select(link => snapshot.Entities[link]).ToList();
        if (links.Count == 0)
        {
            return false;
        }
        var last = links[^1];
        return last.Props.Is(Prop.PowerSource)
            && last.Props.Get(Prop.PoweredBy) is null
            && links.All(link => link.Status != EntityStatus.Destroyed && link.Props.Get(Prop.On) != false);
    }

    // The agent at the end of an entity's `controlled_by` walk, whatever state the links are in.
    public static string? Controller(Snapshot snapshot, string id)
    {
        var path = Walk(snapshot, id, Prop.ControlledBy);
        if (path.Count < 2)
        {
            return null;
        }
        var last = snapshot.Entities[path[^1]];
        return last.Props.Is(Prop.Agent) && last.Props.Get(Prop.ControlledBy) is null
            ? last.Id
            : null;
    }

    // The first link from the device toward its controller, the device included and the controller not, that cannot
    // carry a command: a destroyed one, then one with no power.
    public static RemoteFault? RemoteFaultOf(Snapshot snapshot, string device)
    {
        var links = Walk(snapshot, device, Prop.ControlledBy);
        return FaultOn(snapshot, links.Take(links.Count - 1));
    }

    // The same walk, cut at the panel a subject works the device through: the panel included, the rest of the walk to the
    // controller not (`docs/panel.md`).
    public static RemoteFault? PanelFault(Snapshot snapshot, string device, string panel)
    {
        var path = Walk(snapshot, device, Prop.ControlledBy);
        return FaultOn(snapshot, path.Take(path.IndexOf(panel) + 1));
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
        var path = Walk(snapshot, device, Prop.ControlledBy);
        return path.Skip(1).Take(Math.Max(0, path.Count - 2)).FirstOrDefault(id =>
        {
            var entity = snapshot.Entities[id];
            return entity.Props.Is(Prop.Panel)
                && entity.Status != EntityStatus.Destroyed
                && Reach.InReach(snapshot, actor, id);
        });
    }

    // The devices of one kind (`camera` or `intercom`) whose feed reaches the observer now: each one not destroyed,
    // its control walk ending at the observer and carrying a command, in id order.
    public static List<string> Feeds(Snapshot snapshot, string observer, Prop<bool> kind) =>
        [.. snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .Where(id =>
            {
                var device = snapshot.Entities[id];
                return device.Props.Is(kind)
                    && device.Status != EntityStatus.Destroyed
                    && Controller(snapshot, id) == observer
                    && RemoteFaultOf(snapshot, id) is null;
            })];

    // Why an agent cannot act or sense now: a controlled one its own control walk's fault, else its controller's;
    // any other its own power, when it has a `powered_by`. Null for an agent with neither.
    public static RemoteFault? AgentFault(Snapshot snapshot, string agent)
    {
        if (!snapshot.Entities.TryGetValue(agent, out var entity))
        {
            return null;
        }
        if (entity.Props.Get(Prop.ControlledBy) is not null)
        {
            if (RemoteFaultOf(snapshot, agent) is { } fault)
            {
                return fault;
            }
            return Controller(snapshot, agent) is { } head ? AgentFault(snapshot, head) : null;
        }
        if (entity.Props.Get(Prop.PoweredBy) is not null && !Powered(snapshot, agent))
        {
            return new Unpowered(agent, CutOf(snapshot, agent));
        }
        return null;
    }

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
        var path = Walk(snapshot, link, Prop.PoweredBy);
        return path.FirstOrDefault(id =>
        {
            var entity = snapshot.Entities[id];
            return entity.Status == EntityStatus.Destroyed || entity.Props.Get(Prop.On) == false;
        }) ?? path[^1];
    }
}

public abstract record RemoteFault
{
    public abstract Code ReasonCode { get; }

    public abstract IReadOnlyDictionary<string, JsonNode?> ReasonData { get; }
}

public sealed record Disconnected(string At) : RemoteFault
{
    public override Code ReasonCode => Code.Disconnected;

    public override IReadOnlyDictionary<string, JsonNode?> ReasonData =>
        new Dictionary<string, JsonNode?> { ["at"] = At };
}

public sealed record Unpowered(string At, string Cut) : RemoteFault
{
    public override Code ReasonCode => Code.Unpowered;

    public override IReadOnlyDictionary<string, JsonNode?> ReasonData =>
        new Dictionary<string, JsonNode?> { ["at"] = At, ["cut"] = Cut };
}
