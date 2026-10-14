using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The director's handle (src/director-world.ts `directorWorld`, `docs/roles.md`): what a world reads, and writes only through `edit`
// under the director role, so the engine refuses what a director may not send. It has no `command`: a director acts between rounds
// through its levers, never as a character. It learns which players have submitted, never what they submitted, and it closes a round
// with those moves.
public sealed class DirectorWorld(IWorld world)
{
    public Snapshot Current() => world.CurrentSnapshot();

    // An edit under the director's role (`by`), so the engine refuses what a director may not send.
    public Pipeline.Result Edit(JsonObject edit, string? commandId = null, bool perceivers = false) =>
        world.Edit(edit, commandId, perceivers, new By(Role.Director));

    // The handles that hold a pending move for the next round; their moves are not in it.
    public IReadOnlyList<string> Submitted() => world.Pending.Handles();

    // Takes every pending move as one round, each under its player's role, and the close under the director's. A round the world
    // refuses takes no move: the players' moves stay pending for the next close.
    public Round.Outcome CloseRound()
    {
        var handles = world.Pending.Handles();
        // Each move is for the body it was submitted for, which a successor may have taken over since: the round takes it for the body
        // the handle drives when the round closes.
        var snapshot = world.CurrentSnapshot();
        var moves = handles
            .SelectMany(handle => world.Pending.Moves(handle).Select(command => command with
            {
                Actor = Runs.LiveBodyOf(snapshot, command.Actor),
                By = new By(Role.Player, handle),
            }))
            .ToList();
        var result = world.TakeRoundAs(moves);
        if (result.Status == Status.Ok)
        {
            foreach (var handle in handles)
            {
                world.Pending.Clear(handle);
            }
        }
        return result;
    }

    // Closes empty rounds while every live registered player is idle (`docs/rounds.md`), stopping after `max`, one round before the beat
    // `stopBefore` names, or at the first round a registered body senses an event of.
    public JsonObject CloseRounds(int max, string? stopBefore = null)
    {
        var idle = world.Pending.Idlers().ToHashSet(StringComparer.Ordinal);
        var moving = world.Pending.Handles().ToHashSet(StringComparer.Ordinal);
        var snapshot = world.CurrentSnapshot();
        var liveHandles = (snapshot.Run?.Players ?? [])
            .Where(player => LiveOf(snapshot, player.Slot).Count > 0)
            .Select(player => player.Handle)
            .ToList();
        // Every live player must be idle: one that has a move, or has not passed, keeps the time as it is.
        if (liveHandles.Any(handle => !idle.Contains(handle) || moving.Contains(handle)))
        {
            return Quiet("refused", rounds: 0, reasonCode: WorldJson.Name(Code.PlayersActive));
        }
        if (stopBefore is not null && PendingDue(stopBefore) is null)
        {
            return Quiet("refused", rounds: 0, reasonCode: WorldJson.Name(Code.NoSuchBeat));
        }
        var rounds = 0;
        while (true)
        {
            if (rounds >= max)
            {
                return Quiet("ok", rounds, stopped: "max");
            }
            var due = stopBefore is null ? null : PendingDue(stopBefore);
            // One tick short of the beat: the next round would be the one that falls it due.
            if (due is not null && world.CurrentSnapshot().Tick + 1 >= due)
            {
                return Quiet("ok", rounds, stopped: "beat");
            }
            var before = world.CurrentSnapshot();
            var closed = world.TakeRoundAs([]);
            if (closed.Status != Status.Ok || closed.Closing is null)
            {
                return Quiet("refused", rounds, reasonCode: Pipeline.ReasonName(closed.ReasonCode, closed.Status));
            }
            rounds += 1;
            // A registered body that sensed anything the round made stops the quiet: no player sleeps through it.
            if (world.Heard(before, closed.Closing.Snapshot, closed.Closing.Events, LiveBodies()))
            {
                return Quiet("ok", rounds, stopped: "heard");
            }
        }
    }

    // The bodies of a slot that are in the world and not destroyed.
    private static List<string> LiveOf(Snapshot snapshot, string slot) =>
        [.. Runs.DriverBodies(snapshot, slot).Where(body => snapshot.Entities.TryGetValue(body, out var entity) && entity.Status != EntityStatus.Destroyed)];

    // The live bodies of every registered player.
    private List<string> LiveBodies()
    {
        var snapshot = world.CurrentSnapshot();
        return [.. (snapshot.Run?.Players ?? []).SelectMany(player => LiveOf(snapshot, player.Slot))];
    }

    private long? PendingDue(string id)
    {
        var cause = world.Scheduled().FirstOrDefault(entry => entry.Kind == "beat" && entry.Id == id);
        return cause?.DueTick;
    }

    private static JsonObject Quiet(string status, int rounds, string? stopped = null, string? reasonCode = null)
    {
        var output = new JsonObject { ["status"] = status };
        if (reasonCode is not null)
        {
            output["reason_code"] = reasonCode;
        }
        output["rounds"] = rounds;
        if (stopped is not null)
        {
            output["stopped"] = stopped;
        }
        return output;
    }
}
