using WorldEngine.Core.Model;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// The move verb (src/engine/verbs/move.ts): an agent walks to a position in its room, into a room by id, or through a
// door named like a target. Being carried, having no means to move, a shut door, a room it cannot name, a wall or a
// barrier on the way, and a walk out of the room are refused. The walker and all it holds move with it.
public static class MoveVerb
{
    public static Pipeline.VerbDecl Move { get; } = new(
        RequiresTarget: false,
        AuthorOnly: false,
        Preconditions: Preconditions,
        OneTick: true,
        Suggest: Suggest,
        FreeArgs: true,
        Transition: Transition);

    // The room on the far side of each doorway the actor can address, since reading the door gives both its ends, and its own
    // room when it stands on something, to step down: on the floor, moving there changes nothing (src/engine/verbs/move.ts
    // `suggest`). The position to walk to is free.
    private static IReadOnlyList<Value.Map> Suggest(Pipeline.CommandContext context, IReadOnlyList<string> nameable)
    {
        var actor = context.Snapshot.Entities[context.Command.Actor];
        var here = actor.Location;
        var rooms = new SortedSet<string>(StringComparer.Ordinal);
        if (here is not null)
        {
            rooms.Add(here);
        }
        foreach (var id in nameable)
        {
            if (!context.Snapshot.Entities.TryGetValue(id, out var door))
            {
                continue;
            }
            if (door.Props.Get(Prop.From) is not { } from
                || door.Props.Get(Prop.To) is not { } to)
            {
                continue;
            }
            if (from == here)
            {
                rooms.Add(to);
            }
            else if (to == here)
            {
                rooms.Add(from);
            }
        }
        return [.. rooms
            .Where(room => context.Snapshot.Entities.TryGetValue(room, out var entity)
                && entity.Template == TemplateIds.Room
                && !(room == here && OnFloor(actor)))
            .Select(location => Pipeline.Reason(("location", location)))];
    }

    // Where the command says to go. Exactly one of the three forms.
    private abstract record Destination;

    private sealed record AtPosition(Pos Pos) : Destination;

    private sealed record InRoom(string Id) : Destination;

    private sealed record ThroughDoor(string Text) : Destination;

    private static Destination? DestinationOf(Value.Map? args)
    {
        if (args is null)
        {
            return null;
        }
        var hasTo = args.ContainsKey("to");
        var hasLocation = args.ContainsKey("location");

        if (args.ContainsKey("through"))
        {
            return !hasTo && !hasLocation && Text(args, "through") is { Length: > 0 } door ? new ThroughDoor(door) : null;
        }
        if (hasTo && !hasLocation)
        {
            return args["to"] is Value.Map to
                && to.GetValueOrDefault("x").AsInt() is { } px
                && to.GetValueOrDefault("y").AsInt() is { } py
                    ? new AtPosition(new Pos(px, py))
                    : null;
        }
        if (hasLocation && !hasTo && Text(args, "location") is { } room)
        {
            return new InRoom(room);
        }
        return null;
    }

    private static string? Text(Value.Map args, string key) => args.GetValueOrDefault(key).AsText();

    // The rooms an agent can name: its own, and those a doorway of its own room leads to, open or shut. Any other room id
    // answers as one that does not exist, so `move` cannot be used to map the world.
    private static bool NameableRoom(Pipeline.CommandContext context, string to)
    {
        var here = context.Snapshot.Entities[context.Command.Actor].Location;
        return to == here
            || context.Snapshot.Entities.Values.Any(entity => Reach.DoorJoins(entity.Props, here, to));
    }

    // The room on the far side of the door a command names through. The door is named as any target is, so one the actor
    // cannot tell is there is unresolved; a thing that is no door of the actor's room, or whose other end is no room, is
    // invalid_location; a shut door is no_open_door. Returns the far room, or the refusal.
    private static (string? Room, Pipeline.Refusal? Failure) FarSideOf(Pipeline.CommandContext context, string text)
    {
        var snapshot = context.Snapshot;
        var resolution = Resolve.ResolveTarget(snapshot, context.Registry, context.Command.Actor, text);
        switch (resolution)
        {
            case Resolve.Unresolved:
                return (null, new Pipeline.Refusal(Status.Unresolved, null));
            case Resolve.Ambiguous ambiguous:
                return (null, new Pipeline.Refusal(Status.Ambiguous, null, Candidates: ambiguous.Candidates));
        }
        var resolved = (Resolve.Resolved)resolution;
        var door = resolved.Target.Part is null ? snapshot.Entities.GetValueOrDefault(resolved.Target.EntityId) : null;
        var here = snapshot.Entities[context.Command.Actor].Location;
        var from = door is null ? null : door.Props.Get(Prop.From);
        var to = door is null ? null : door.Props.Get(Prop.To);
        if (door is null || here is null || from is null || to is null || (from != here && to != here))
        {
            return (null, Pipeline.Invalid(Code.InvalidLocation));
        }
        var far = from == here ? to : from;
        if (snapshot.Entities.GetValueOrDefault(far)?.Template != TemplateIds.Room)
        {
            return (null, Pipeline.Invalid(Code.InvalidLocation));
        }
        return door.Props.Is(Prop.Open)
            ? (far, null)
            : (null, Pipeline.Refused(Code.NoOpenDoor));
    }

    // The destination with any door resolved away: through a door is a move to the room beyond it (`via`).
    private static (Destination? To, bool Via, Pipeline.Refusal? Failure) WalkTo(Pipeline.CommandContext context, Destination asked)
    {
        if (asked is not ThroughDoor door)
        {
            return (asked, false, null);
        }
        var (room, failure) = FarSideOf(context, door.Text);
        return failure is null ? (new InRoom(room!), true, null) : (null, false, failure);
    }

    private static bool HasOpenDoor(Pipeline.CommandContext context, string to)
    {
        var from = context.Snapshot.Entities[context.Command.Actor].Location;
        return context.Snapshot.Entities.Values.Any(entity =>
            Resolve.IsDoor(entity) && entity.Props.Is(Prop.Open) && Reach.DoorJoins(entity.Props, from, to));
    }

    // The agent that carries a held agent: the first agent up its containment chain, or, with none, the thing it sits in.
    private static string CarrierOf(Snapshot snapshot, Entity entity)
    {
        var first = entity.ContainedIn!;
        string? holder = first;
        for (var steps = 0; holder is not null && steps < 64; steps += 1)
        {
            if (!snapshot.Entities.TryGetValue(holder, out var body))
            {
                break;
            }
            if (Reach.IsAgent(snapshot, body.Id))
            {
                return body.Id;
            }
            holder = body.ContainedIn;
        }
        return first;
    }

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var asked = DestinationOf(context.Command.Args);
        if (asked is null)
        {
            return Pipeline.Invalid(Code.InvalidArgs);
        }
        var snapshot = context.Snapshot;
        var actor = snapshot.Entities[context.Command.Actor];
        // Held in someone's grip or mouth, an agent goes where it is carried: its own walk is not its to make.
        if (actor.ContainedIn is not null)
        {
            return new Pipeline.Refusal(
                Status.Refused,
                Code.BeingCarried,
                Pipeline.Reason(("carrier", CarrierOf(snapshot, actor))));
        }
        var moving = Capacities.Of(snapshot, context.Registry, actor.Id, Capacity.Moving) ?? 0;
        if (moving < 1)
        {
            return new Pipeline.Refusal(
                Status.Refused,
                Code.InsufficientMoving,
                Pipeline.Reason(("capacity", Capacity.Moving), ("have", moving), ("need", 1L)));
        }

        var walk = WalkTo(context, asked);
        if (walk.Failure is { } failure)
        {
            return failure;
        }
        if (walk.To is InRoom room)
        {
            var location = snapshot.Entities.GetValueOrDefault(room.Id);
            if (location is null || location.Template != TemplateIds.Room || !NameableRoom(context, room.Id))
            {
                return Pipeline.Invalid(Code.InvalidLocation);
            }
            // Through a door, the door named is the one that was judged open; by room, any open door will do.
            if (!walk.Via && room.Id != actor.Location && !HasOpenDoor(context, room.Id))
            {
                return Pipeline.Refused(Code.NoOpenDoor);
            }
        }
        return RefusedBy(StopFor(context, walk.To!));
    }

    // An agent standing on the floor walks; one standing on something else steps down, and like one arriving through a door
    // is checked only where it lands.
    internal static bool OnFloor(Entity actor) => actor.Support is not null && actor.Support == actor.Location;

    private static Geometry.WalkStop? Landing(Pipeline.CommandContext context, string room, Pos pos)
    {
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        var arrived = snapshot.Entities[actorId] with { Location = room, Support = room, Pos = pos };
        var entities = new Dictionary<string, Entity>(snapshot.Entities, StringComparer.Ordinal) { [actorId] = arrived };
        return Geometry.WalkStopFor(snapshot with { Entities = entities }, context.Registry, actorId, pos, arriving: true);
    }

    // Where the walk would stop: a position is walked to in this room, and a room is arrived in at the same coordinates.
    private static Geometry.WalkStop? StopFor(Pipeline.CommandContext context, Destination to)
    {
        var snapshot = context.Snapshot;
        var actor = snapshot.Entities[context.Command.Actor];
        if (to is AtPosition position)
        {
            return OnFloor(actor)
                ? Geometry.WalkStopFor(snapshot, context.Registry, actor.Id, position.Pos)
                : Landing(context, actor.Location!, position.Pos);
        }
        var room = ((InRoom)to).Id;
        var pos = Geometry.EffectivePos(snapshot, actor.Id);
        if (pos is null || (room == actor.Location && OnFloor(actor)))
        {
            return null;
        }
        return Landing(context, room, pos);
    }

    private static Pipeline.Refusal? RefusedBy(Geometry.WalkStop? stop) => stop switch
    {
        null => null,
        Geometry.Blocked blocked => Pipeline.Refused(Code.Blocked, Pipeline.Reason(("with", blocked.With))),
        _ => Pipeline.Refused(Code.OutOfBounds),
    };

    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var actorId = context.Command.Actor;
        var walk = WalkTo(context, DestinationOf(context.Command.Args)!);
        var to = walk.To!;
        var from = Geometry.EffectivePos(working.Snapshot, actorId);
        var movedEvent = working.Emit(EventType.Moved, actorId, Value.Map.Empty, rootEventId);
        var room = to is AtPosition ? context.Snapshot.Entities[actorId].Location! : ((InRoom)to).Id;
        working.SetRelation(actorId, "location", room, movedEvent);
        working.SetRelation(actorId, "support", room, movedEvent);
        working.SetPos(actorId, to is AtPosition position ? position.Pos : from, movedEvent);
        // What the actor holds or carries moves rooms with it; a positional move changes nothing.
        Placements.RefreshSubtreeLocations(working, actorId, movedEvent);
        // A walker and all it carries uncover themselves and what they were hiding, as every mover does.
        foreach (var id in Placements.SubtreeOf(context.Snapshot, actorId))
        {
            Concealment.RevealConcealed(working, id, movedEvent);
        }
    }
}
