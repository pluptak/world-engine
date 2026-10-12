using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// How a device is reached by hand or worked from afar (src/engine/verbs/remote.ts), shared by the verbs that work
// devices: the switches here, and open, close, lock and unlock once they are ported. The walks are in Power.
public static class Remote
{
    // A door is in reach from anywhere in either room it joins when it has no position of its own, or when it stands in
    // the other room; anything else is reached the ordinary way.
    public static bool DeviceInReach(Pipeline.CommandContext context, Entity entity)
    {
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        if (Reach.ReachedAsDoor(snapshot, actorId, entity))
        {
            return true;
        }
        return entity.Pos is not null
            ? Reach.InReach(snapshot, actorId, entity.Id)
            : entity.Location == snapshot.Entities[actorId].Location;
    }

    // The panel an actor that cannot reach a device by hand works it through: it is not the device's controller, and a
    // panel on the device's walk, intact and in its reach, is the one (`Power.PanelFor`).
    private static string? PanelUsed(Pipeline.CommandContext context, Entity entity)
    {
        var actorId = context.Command.Actor;
        if (Power.Controller(context.Snapshot, entity.Id) == actorId || DeviceInReach(context, entity))
        {
            return null;
        }
        return Power.PanelFor(context.Snapshot, entity.Id, actorId);
    }

    // A device whose control walk ends at the actor takes its command there, and so does one an actor works through a
    // panel on its walk: no reach, key or hands, only links that carry it (docs/power.md, docs/panel.md).
    public static bool WorksRemotely(Pipeline.CommandContext context, Entity entity) =>
        Power.Controller(context.Snapshot, entity.Id) == context.Command.Actor || PanelUsed(context, entity) is not null;

    // What a remote command meets on the way: its controller's walk, or the walk as far as the panel it goes through,
    // judged in `snapshot` (the world as it is, unless a verb judges the walk as it would carry the command).
    public static RemoteFault? RemoteFaultFor(Pipeline.CommandContext context, Entity entity, Snapshot? judged = null)
    {
        var snapshot = judged ?? context.Snapshot;
        var panel = PanelUsed(context, entity);
        return panel is null
            ? Power.RemoteFaultOf(snapshot, entity.Id)
            : Power.PanelFault(snapshot, entity.Id, panel);
    }
}
