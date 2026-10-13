using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A player's handle (src/player-world.ts `playerWorld`, `docs/roles.md`): the actor view of the bodies its slot drives, under the
// player role. It submits one move per body for the next round, held in the world until the director closes that round, and it reads
// nothing of another player's move. A move names its body by the view's alias when the slot holds several bodies; a slot of one needs
// no name. Results are as the handle's own callers read them, not the world's.
public sealed class PlayerWorld(IWorld world, string handle)
{

    // A handle's slot: its root (the first body, which names it) and the bodies it drives now, in slot order.
    private sealed record Bound(string Root, IReadOnlyList<string> Bodies);

    // What any of the slot's bodies senses, once each.
    public JsonObject Observe(long? sinceTick = null) => SlotView().Observe(sinceTick);

    public JsonObject? Inspect(string entity) => SlotView().Inspect(entity);

    // One body's options: `body` names it when the slot holds several, and it is the body alone otherwise. A body that is out has none,
    // and says why (`body_out`).
    public JsonObject Options(string? body = null, bool refused = false)
    {
        var (found, id) = NamedOf(body);
        if (BodyOut(world.CurrentSnapshot(), id))
        {
            return new JsonObject
            {
                ["actor"] = ActorAlias.Of(found.Root, id),
                ["ready"] = new JsonArray(),
                ["needs_args"] = new JsonArray(),
                ["reason_code"] = "body_out",
            };
        }
        return new ActorWorld(world, id, found.Root, found.Bodies).OptionsOf(refused);
    }

    // Judged as a round's move, as the actor view judges any command, for the body it names.
    public JsonObject Check(ActorCommand command, string? body = null)
    {
        var (found, id) = NamedOf(body);
        if (BodyOut(world.CurrentSnapshot(), id))
        {
            return new JsonObject
            {
                ["status"] = "refused",
                ["command_id"] = command.CommandId,
                ["resolved_target"] = null,
                ["reason_code"] = "body_out",
            };
        }
        return new ActorWorld(world, id, found.Root, found.Bodies).Check(command);
    }

    // A move written as the view writes things: its own aliases or names, never a world id. Replaces the body's move, and any move held
    // for the body before a successor took it over.
    public JsonObject Submit(ActorCommand move, string? body = null)
    {
        // One snapshot for the whole submit: the binding, the body's state and the successor scan all read the world as it stands.
        var snapshot = world.CurrentSnapshot();
        var player = snapshot.Run?.Players?.FirstOrDefault(entry => entry.Handle == handle);
        if (player is null)
        {
            return Refusal("not_registered");
        }
        if (snapshot.Run?.State != "running")
        {
            return Refusal("run_not_running");
        }
        var found = new Bound(player.Slot, Runs.DriverBodies(snapshot, player.Slot));
        var id = BodyNamed(found, body);
        if (id is null)
        {
            return Refusal(body is null ? "body_required" : "not_a_body");
        }
        if (BodyOut(snapshot, id))
        {
            return Refusal("body_out");
        }
        // The move is the body's own, read back from the view's aliases as the view's own `check` reads it.
        var command = new ActorWorld(world, id, found.Root, found.Bodies).Decode(move);
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
    public JsonObject Withdraw(string? body = null)
    {
        var found = BoundOf();
        if (found is null)
        {
            return Refusal("not_registered");
        }
        if (body is null)
        {
            world.Pending.Clear(handle);
            return Ok();
        }
        var id = BodyNamed(found, body);
        if (id is null)
        {
            return Refusal("not_a_body");
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
    public JsonObject Idle()
    {
        if (BoundOf() is null)
        {
            return Refusal("not_registered");
        }
        world.Pending.SetIdle(handle);
        return Ok();
    }

    // The moves held for the next round, written as the view writes them: an id is the body's alias, and the actor is not said. A body
    // is named only where the slot holds several.
    public JsonArray Pending()
    {
        var found = RequireBound();
        var snapshot = world.CurrentSnapshot();
        JsonNode? Written(JsonNode? value)
        {
            var text = JsonReads.Text(value);
            return text is not null && snapshot.Entities.ContainsKey(text.Split('.')[0])
                ? JsonValue.Create(ActorAlias.Of(found.Root, text))
                : value?.DeepClone();
        }

        return new JsonArray(world.Pending.Moves(handle).Select(held =>
        {
            var body = Runs.LiveBodyOf(snapshot, held.Actor);
            var written = new JsonObject();
            if (found.Bodies.Count > 1)
            {
                written["body"] = ActorAlias.Of(found.Root, body);
            }
            written["command_id"] = held.CommandId;
            written["verb"] = held.Verb;
            if (held.Target is not null)
            {
                written["target"] = Written(JsonValue.Create(held.Target));
            }
            if (held.Args is not null)
            {
                var args = new JsonObject();
                foreach (var (name, value) in held.Args)
                {
                    args[name] = ActorWorld.IsToken(held.Verb, name) ? value?.DeepClone() : Written(value);
                }
                written["args"] = args;
            }
            return (JsonNode?)written;
        }).ToArray());
    }

    // The view that reads through every body of the slot, as the first of them still in the world.
    private ActorWorld SlotView()
    {
        var found = RequireBound();
        var first = found.Bodies.FirstOrDefault(body => world.EntityOf(body) is not null) ?? found.Bodies[0];
        return new ActorWorld(world, first, found.Root, found.Bodies);
    }

    private Bound RequireBound() => BoundOf() ?? throw new WorldError("not_registered", $"No player is registered as {handle}");

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
            ? throw new WorldError(body is null ? "body_required" : "not_a_body", $"No body {body ?? ""} is driven by {handle}")
            : (found, id);
    }

    // A body is out when the world no longer holds it, or holds it destroyed, and no successor took its place.
    private static bool BodyOut(Snapshot snapshot, string body)
    {
        var entity = snapshot.Entities.GetValueOrDefault(Runs.LiveBodyOf(snapshot, body));
        return entity is null || entity.Status == EntityStatus.Destroyed;
    }

    private static JsonObject Ok() => new() { ["status"] = "ok" };

    private static JsonObject Refusal(string reasonCode) => new() { ["status"] = "refused", ["reason_code"] = reasonCode };
}
