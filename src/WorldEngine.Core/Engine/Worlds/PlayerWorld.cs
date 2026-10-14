using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A player's handle (src/player-world.ts `playerWorld`, `docs/roles.md`): the actor view of the bodies its slot drives, under the
// player role. It submits one move per body for the next round, held in the world until the director closes that round, and it reads
// nothing of another player's move. A move names its body by the view's alias when the slot holds several bodies; a slot of one needs
// no name. Results are as the handle's own callers read them, not the world's.
public sealed class PlayerWorld(IWorld world, string handle)
{
    // What came of a submit, a withdraw or an idle.
    public sealed record Answer(Status Status, Code? ReasonCode = null);

    // A move held for the next round, as the view writes it: the body only where the slot holds several.
    public sealed record Move(string? Body, string CommandId, string Verb, string? Target, Value.Map? Args);

    // A handle's slot: its root (the first body, which names it) and the bodies it drives now, in slot order.
    private sealed record Bound(string Root, IReadOnlyList<string> Bodies);

    // What any of the slot's bodies senses, once each.
    public ActorObservation Observe(long? sinceTick = null) => SlotView().Observe(sinceTick);

    public Projection.Inspection? Inspect(string entity) => SlotView().Inspect(entity);

    // One body's options: `body` names it when the slot holds several, and it is the body alone otherwise. A body that is out has none,
    // and says why (`body_out`).
    public ActorOptions Options(string? body = null, bool refused = false)
    {
        var (found, id) = NamedOf(body);
        if (BodyOut(world.CurrentSnapshot(), id))
        {
            return new ActorOptions(ActorAlias.Of(found.Root, id), [], [], ReasonCode: Code.BodyOut);
        }
        return new ActorWorld(world, id, key: found.Root, senses: found.Bodies).OptionsOf(refused);
    }

    // Judged as a round's move, as the actor view judges any command, for the body it names.
    public ActorVerdict Check(ActorCommand command, string? body = null)
    {
        var (found, id) = NamedOf(body);
        if (BodyOut(world.CurrentSnapshot(), id))
        {
            return new ActorVerdict(Status.Refused, command.CommandId, ReasonCode: Code.BodyOut);
        }
        return new ActorWorld(world, id, key: found.Root, senses: found.Bodies).Check(command);
    }

    // A move written as the view writes things: its own aliases or names, never a world id. Replaces the body's move, and any move held
    // for the body before a successor took it over.
    public Answer Submit(ActorCommand move, string? body = null)
    {
        // One snapshot for the whole submit: the binding, the body's state and the successor scan all read the world as it stands.
        var snapshot = world.CurrentSnapshot();
        var player = snapshot.Run?.Players?.FirstOrDefault(entry => entry.Handle == handle);
        if (player is null)
        {
            return Refusal(Code.NotRegistered);
        }
        if (snapshot.Run?.State != "running")
        {
            return Refusal(Code.RunNotRunning);
        }
        var found = new Bound(player.Slot, Runs.DriverBodies(snapshot, player.Slot));
        var id = BodyNamed(found, body);
        if (id is null)
        {
            return Refusal(body is null ? Code.BodyRequired : Code.NotABody);
        }
        if (BodyOut(snapshot, id))
        {
            return Refusal(Code.BodyOut);
        }
        // The move is the body's own, read back from the view's aliases as the view's own `check` reads it.
        var command = new ActorWorld(world, id, key: found.Root, senses: found.Bodies).Decode(move);
        foreach (var held in world.Pending.Moves(handle).ToList())
        {
            if (Runs.LiveBodyOf(snapshot, held.Actor) == id)
            {
                world.Pending.Clear(handle, held.Actor);
            }
        }
        world.Pending.Set(handle, command);
        return Ok();
    }

    // Drops the move for one body, or every move the handle holds.
    public Answer Withdraw(string? body = null)
    {
        var found = BoundOf();
        if (found is null)
        {
            return Refusal(Code.NotRegistered);
        }
        if (body is null)
        {
            world.Pending.Clear(handle);
            return Ok();
        }
        var id = BodyNamed(found, body);
        if (id is null)
        {
            return Refusal(Code.NotABody);
        }
        var snapshot = world.CurrentSnapshot();
        foreach (var held in world.Pending.Moves(handle).ToList())
        {
            if (Runs.LiveBodyOf(snapshot, held.Actor) == id)
            {
                world.Pending.Clear(handle, held.Actor);
            }
        }
        return Ok();
    }

    // Passes every round until the handle submits again, and drops any move (`docs/rounds.md`).
    public Answer Idle()
    {
        if (BoundOf() is null)
        {
            return Refusal(Code.NotRegistered);
        }
        world.Pending.SetIdle(handle);
        return Ok();
    }

    // The moves held for the next round, written as the view writes them: an id is the body's alias, and the actor is not said. A body
    // is named only where the slot holds several.
    public IReadOnlyList<Move> Pending()
    {
        var found = RequireBound();
        var snapshot = world.CurrentSnapshot();
        Value Written(Value value) =>
            value.AsText() is { } text && snapshot.Entities.ContainsKey(text.Split('.')[0]) ? ActorAlias.Of(found.Root, text) : value;

        return [.. world.Pending.Moves(handle).Select(held => new Move(
            found.Bodies.Count > 1 ? ActorAlias.Of(found.Root, Runs.LiveBodyOf(snapshot, held.Actor)) : null,
            held.CommandId,
            held.Verb,
            held.Target is null ? null : Written(held.Target).AsText(),
            held.Args is null
                ? null
                : Value.Of(held.Args.Select(pair => KeyValuePair.Create(
                    pair.Key,
                    (Value?)(ActorWorld.IsToken(held.Verb, pair.Key) ? pair.Value : Written(pair.Value)))))))];
    }

    // The view that reads through every body of the slot, as the first of them still in the world.
    private ActorWorld SlotView()
    {
        var found = RequireBound();
        var first = found.Bodies.FirstOrDefault(body => world.EntityOf(body) is not null) ?? found.Bodies[0];
        return new ActorWorld(world, first, key: found.Root, senses: found.Bodies);
    }

    private Bound RequireBound() => BoundOf() ?? throw new WorldError(Code.NotRegistered, $"No player is registered as {handle}");

    private Bound? BoundOf()
    {
        var snapshot = world.CurrentSnapshot();
        var player = snapshot.Run?.Players?.FirstOrDefault(entry => entry.Handle == handle);
        return player is null ? null : new Bound(player.Slot, Runs.DriverBodies(snapshot, player.Slot));
    }

    // The body a move names by its alias in the view: the slot's one body when none is named and it holds one, else null.
    private static string? BodyNamed(Bound bound, string? body)
    {
        if (body is null)
        {
            return bound.Bodies.Count == 1 ? bound.Bodies[0] : null;
        }
        return bound.Bodies.FirstOrDefault(candidate => ActorAlias.Of(bound.Root, candidate) == body);
    }

    // The body a read or a check names, with its slot: a throw when the body is unnamed or not the handle's.
    private (Bound Found, string Id) NamedOf(string? body)
    {
        var found = RequireBound();
        var id = BodyNamed(found, body);
        return id is null
            ? throw new WorldError(body is null ? Code.BodyRequired : Code.NotABody, $"No body {body ?? ""} is driven by {handle}")
            : (found, id);
    }

    // A body is out when the world no longer holds it, or holds it destroyed, and no successor took its place.
    private static bool BodyOut(Snapshot snapshot, string body)
    {
        var entity = snapshot.Entities.GetValueOrDefault(Runs.LiveBodyOf(snapshot, body));
        return entity is null || entity.Status == EntityStatus.Destroyed;
    }

    private static Answer Ok() => new(Status.Ok);

    private static Answer Refusal(Code reasonCode) => new(Status.Refused, reasonCode);
}
