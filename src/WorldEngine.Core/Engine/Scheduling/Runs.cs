using System.Globalization;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A run's life (src/engine/run.ts, docs/run.md): registering when the scene is built, running once started, ended for a
// reason. The gate and the clock's limit read the state here; an edit sets it and a command ends it.
public static class Runs
{
    // What the run's state refuses, or null. An ended run takes no command and no edit. One still registering takes no
    // command but an edit: its edits are how the author sets it going. A running one takes an agent's command and the
    // author's advance only in a round (`docs/rounds.md`), so a lone one is `round_only`.
    public static string? RunRefusal(Snapshot snapshot, string verb, bool authored, bool round)
    {
        var state = snapshot.Run?.State;
        if (state == "ended")
        {
            return "run_ended";
        }
        if (verb == "edit")
        {
            return null;
        }
        if (state == "registering")
        {
            return "run_not_running";
        }
        return state == "running" && !round && (!authored || verb == "advance") ? "round_only" : null;
    }

    // The ticks a running run may still pass before its limit, or null when no limit applies.
    public static long? TicksLeft(Snapshot snapshot)
    {
        var run = snapshot.Run;
        if (run is null || run.State != "running" || run.TickLimit is null)
        {
            return null;
        }
        return Math.Max(0, run.TickLimit.Value - snapshot.Tick);
    }

    // Binds a player's handle to a slot; the record keeps the order they registered in.
    public static void RegisterPlayer(Working working, string handle, string slot)
    {
        var run = working.Snapshot.Run ?? throw new InvalidOperationException("Registration without a run");
        var players = (run.Players ?? []).Append(new Player(handle, slot)).ToList();
        working.SetRun(run with { Players = players });
    }

    public static void StartRun(Working working)
    {
        var run = working.Snapshot.Run ?? throw new InvalidOperationException("Run edit without a run");
        working.SetRun(run with { State = "running" });
    }

    // The run ends at the tick it is at, and what is still scheduled is dropped with nothing recorded: no time passes again,
    // and the modifiers stay as they are.
    public static void EndRun(Working working, string reason)
    {
        var run = working.Snapshot.Run ?? throw new InvalidOperationException("Run end without a run");
        working.SetRun(run with { State = "ended", Ended = new RunEnd(reason, working.Snapshot.Tick) });
        Schedule.Replace(working, []);
    }

    // The body a slot's player drives now: the slot's entity, or the newest successor along `succeeds` from it, and so on
    // down the chain (`docs/templates.md`). A slot with no successor is its own body.
    public static string LiveBodyOf(Snapshot snapshot, string slot)
    {
        var current = slot;
        for (var steps = 0; steps < Limits.MaxSuccessionSteps; steps += 1)
        {
            string? next = null;
            foreach (var entity in snapshot.Entities.Values)
            {
                if (entity.Props.Get(Prop.Succeeds) == current && (next is null || NumberAfter(entity.Id, next)))
                {
                    next = entity.Id;
                }
            }
            if (next is null)
            {
                return current;
            }
            current = next;
        }
        return current;
    }

    // The bodies a slot holds, in the order the scene named them: one id, or the list a slot of several is stored as.
    public static IReadOnlyList<string> SlotMembers(JsonNode entry) =>
        entry is JsonArray array ? array.Select(member => member!.GetValue<string>()).ToList() : [entry.GetValue<string>()];

    // The first body of each slot: the id a registration names the slot by (`docs/roles.md`). A slot with no body names nothing
    // a registration could name, so it is left out (src/engine/run.ts has it as undefined, which no id equals).
    public static List<string> SlotRoots(Snapshot snapshot) =>
        [.. (snapshot.Run?.Slots ?? []).Select(SlotMembers).Where(members => members.Count > 0).Select(members => members[0])];

    // The bodies a handle drives under a slot, in the order the scene named them, each as the body it is now (a successor where one
    // took over), without repeats: one body for a slot of one (src/engine/run.ts `driverBodies`).
    public static List<string> DriverBodies(Snapshot snapshot, string root)
    {
        var entry = (snapshot.Run?.Slots ?? []).FirstOrDefault(slot => SlotMembers(slot) is { Count: > 0 } members && members[0] == root);
        var members = entry is null ? [root] : SlotMembers(entry);
        return [.. members.Select(member => LiveBodyOf(snapshot, member)).Distinct(StringComparer.Ordinal)];
    }

    // After an ok command or edit: a running run that has reached its limit ends for that reason, and one whose slots are
    // all destroyed or gone ends for no live players. A run with no slots never ends the second way. A registering run
    // never ends by itself: the author may still be fixing its scene.
    public static void FinishRun(Working working)
    {
        var run = working.Snapshot.Run;
        if (run is null || run.State != "running")
        {
            return;
        }
        if (run.TickLimit is { } limit && working.Snapshot.Tick >= limit)
        {
            EndRun(working, "tick_limit");
            return;
        }
        // A slot is alive while one of its bodies' live body is in the world and not destroyed (`LiveBodyOf`).
        bool Alive(string body)
        {
            var live = LiveBodyOf(working.Snapshot, body);
            return working.Snapshot.Entities.TryGetValue(live, out var entity) && entity.Status != EntityStatus.Destroyed;
        }
        if (run.Slots is not null && !run.Slots.Any(entry => SlotMembers(entry).Any(Alive)))
        {
            EndRun(working, "no_live_players");
        }
    }

    // Whether `candidate`'s number is greater than `current`'s, as src/engine/run.ts compares the `e<n>` ids; an id with no
    // number is never greater.
    private static bool NumberAfter(string candidate, string current) =>
        long.TryParse(candidate.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var a)
        && long.TryParse(current.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var b)
        && a > b;
}
