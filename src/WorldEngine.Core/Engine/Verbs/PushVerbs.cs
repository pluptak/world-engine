using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using static WorldEngine.Core.Json.JsNumber;

namespace WorldEngine.Core.Engine;

// The push and pull verbs (src/engine/verbs/push.ts): an actor slides a thing lying on a room's floor across it, along one
// of the four axes. A pull is a push the other way. The slide stops where the thing meets another (`collided`), which
// takes harm by mass times distance (`Physical.ResolveImpact`), or is refused when it cannot move at all.
public static class PushVerbs
{
    public static Pipeline.VerbDecl Push { get; } = Declare(reverse: false);

    public static Pipeline.VerbDecl Pull { get; } = Declare(reverse: true);

    private static readonly string[] Directions = ["+x", "-x", "+y", "-y"];

    private static Pipeline.VerbDecl Declare(bool reverse) => new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: context => Preconditions(context, reverse),
        Duration: _ => 1,
        OneTick: true,
        Transition: (working, context, rootEventId) => Transition(working, context, rootEventId, reverse));

    private sealed record Movement(long DistanceCm, string Direction);

    // The distance (30 cm by default) and the direction (`+x` by default) the command names; null when either is malformed.
    private static Movement? MovementOf(Pipeline.CommandContext context)
    {
        var args = context.Command.Args;
        var distance = 30L;
        if (args is not null && args.TryGetValue("distance_cm", out var raw))
        {
            if (raw is not JsonValue json || !json.TryGetValue(out long named) || named < 0 || named > MaxSafeInteger)
            {
                return null;
            }
            distance = named;
        }
        var direction = "+x";
        if (args is not null && args.TryGetValue("dir", out var dirNode))
        {
            if (dirNode is not JsonValue dirJson || !dirJson.TryGetValue(out string? named) || !Directions.Contains(named))
            {
                return null;
            }
            direction = named;
        }
        return new Movement(distance, direction);
    }

    // A pull names the direction it pulls from, so its target travels the other way.
    private static string Travel(Movement move, bool reverse)
    {
        if (!reverse)
        {
            return move.Direction;
        }
        return (move.Direction[0] == '+' ? "-" : "+") + move.Direction[1..];
    }

    private static Geometry.Sweep Swept(Pipeline.CommandContext context, string targetId, Movement move, bool reverse) =>
        Geometry.Slide(
            context.Snapshot,
            context.Registry,
            targetId,
            Travel(move, reverse),
            move.DistanceCm,
            id => Resolve.IsAbstract(context.Registry, context.Snapshot.Entities.GetValueOrDefault(id))
                || Resolve.IsScenery(context.Registry, context.Snapshot.Entities.GetValueOrDefault(id)));

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context, bool reverse)
    {
        var move = MovementOf(context);
        if (move is null)
        {
            return Pipeline.Invalid("invalid_args");
        }
        var target = context.Target;
        if (target is null)
        {
            return Pipeline.Invalid("missing_target");
        }
        if (target.Part is not null)
        {
            return Pipeline.Refused("target_attached");
        }
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var entity))
        {
            return Pipeline.Invalid("no_such_entity");
        }
        if (Address.OutOfReach(snapshot, actorId, entity.Id) is { } reach)
        {
            return reach;
        }
        var moving = Capacities.Of(snapshot, context.Registry, actorId, "moving") ?? 0;
        if (moving < 1)
        {
            return new Pipeline.Refusal(
                Status.Refused,
                "insufficient_moving",
                Pipeline.Reason(("capacity", "moving"), ("have", moving), ("need", 1L)));
        }
        if (entity.ContainedIn is not null)
        {
            return Pipeline.Refused("target_carried");
        }
        // A push slides a footprint across a room's floor; a cup on a table moves by `take` and `put`.
        var support = entity.Support is null ? null : snapshot.Entities.GetValueOrDefault(entity.Support);
        if (support?.Template != TemplateIds.Room || entity.Pos is null)
        {
            return new Pipeline.Refusal(
                Status.Refused,
                "not_on_floor",
                entity.Support is null ? null : Pipeline.Reason(("support", entity.Support)));
        }
        if (!context.Registry.TryGetValue(entity.Template, out var template))
        {
            return Pipeline.Invalid("unknown_template");
        }
        var force = moving * 10;
        if (template.MassG > force * 20)
        {
            return Pipeline.Refused("too_heavy");
        }
        var path = Swept(context, entity.Id, move, reverse);
        if (move.DistanceCm > 0 && path.Distance == 0 && path.Obstacle is { } obstacle)
        {
            return Pipeline.Refused("blocked", Pipeline.Reason(("with", obstacle)));
        }
        return null;
    }

    private static Pos Offset(Pos position, string direction, long distance)
    {
        var sign = direction[0] == '+' ? 1 : -1;
        return direction[1] == 'x'
            ? new Pos(position.X + distance * sign, position.Y)
            : new Pos(position.X, position.Y + distance * sign);
    }

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId, bool reverse)
    {
        var targetId = context.Target!.EntityId;
        var move = MovementOf(context) ?? throw new InvalidOperationException("Push movement changed after validation");
        var current = context with { Snapshot = working.Snapshot };
        var position = Geometry.EffectivePos(working.Snapshot, targetId)
            ?? throw new InvalidOperationException("Push target has no position");

        var path = Swept(current, targetId, move, reverse);
        var movedEvent = working.Emit("moved", targetId, Pipeline.Reason(("distance_cm", path.Distance)), rootEventId);
        working.SetPos(targetId, Offset(position, Travel(move, reverse), path.Distance), movedEvent);
        Concealment.RevealConcealed(working, targetId, movedEvent);
        // What stands on the target rides along; only stopping short jolts off what topples.
        if (path.Obstacle is { } obstacle)
        {
            var collidedEvent = working.Emit("collided", targetId, Pipeline.Reason(("with", obstacle)), movedEvent);
            Physical.ResolveImpact(working, context.Registry, targetId, obstacle, path.Distance, collidedEvent);
            Physical.PropagateSupportLoss(working, context.Registry, targetId, collidedEvent);
        }
    }
}
