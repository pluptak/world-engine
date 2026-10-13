using System.Text.Json.Nodes;
using WorldEngine.Cli;

namespace WorldEngine.Host;

// A player's turn: the round, and the observation the host fetched for its handle.
public sealed record Turn(int Round, JsonNode? Observation);

// A player is an async function of its turn. It answers a move (an object), an array of moves (one per body), or the string "idle".
public delegate Task<JsonNode> Player(Turn turn);

public sealed record Dropped(int Round, string Handle);

public sealed record HostResult(int Rounds, string? Ended, IReadOnlyList<Dropped> Dropped);

// A reference host (`docs/host.md`): it plays a run through the command line's JSON ops alone. Every request goes through `CliRunner` as
// text and every answer is read back as text, so the host sees only what a caller in another language would. The host waits for the
// players at most `timeout_ms` per round, one deadline for the whole round.
public static class HostRun
{
    public static async Task<HostResult> Play(string scenePath, JsonObject plan, string dir, IReadOnlyDictionary<string, Player> players)
    {
        var transcript = Path.Combine(dir, "transcript.jsonl");
        void Record(JsonNode request, JsonNode? response) =>
            File.AppendAllText(transcript, new JsonObject { ["request"] = request.DeepClone(), ["response"] = response?.DeepClone() }.ToJsonString() + "\n");
        JsonObject Call(JsonObject request)
        {
            var response = JsonNode.Parse(CliRunner.Run([], request.ToJsonString()).Stdout)!.AsObject();
            Record(request, response);
            return response;
        }
        void Ok(JsonObject response, string what)
        {
            if ((string?)response["status"] != "ok")
            {
                throw new InvalidOperationException($"{what} refused: {response.ToJsonString()}");
            }
        }

        var init = JsonNode.Parse(CliRunner.Run(["init", dir, scenePath], "").Stdout)!.AsObject();
        Record(new JsonObject { ["op"] = "init", ["scene"] = scenePath, ["world"] = dir }, init);
        Ok(init, "init");

        JsonObject SnapshotOf() => Call(new JsonObject { ["op"] = "snapshot", ["world"] = dir });
        var timeoutMs = (int)plan["timeout_ms"]!;
        var handles = plan["handles"]!.AsObject().Select(pair => (Handle: pair.Key, Entry: pair.Value!.AsObject())).ToList();
        var names = SnapshotOf();
        foreach (var (handle, entry) in handles)
        {
            Ok(
                Call(new JsonObject
                {
                    ["op"] = "director_edit",
                    ["world"] = dir,
                    ["edit"] = new JsonObject { ["kind"] = "register_player", ["handle"] = handle, ["slot"] = IdNamed(names, (string)entry["slot"]!) },
                }),
                $"register {handle}");
        }
        Ok(Call(new JsonObject { ["op"] = "director_edit", ["world"] = dir, ["edit"] = new JsonObject { ["kind"] = "start_run" } }), "start_run");

        var rounds = handles.Select(h => h.Entry["moves"]!.AsArray().Count).DefaultIfEmpty(0).Max();
        var dropped = new List<Dropped>();
        var round = 0;
        for (; round < rounds; round++)
        {
            if (RunState(SnapshotOf()) == "ended")
            {
                break;
            }
            var pending = handles.Select(h =>
            {
                var observation = Call(new JsonObject { ["op"] = "player_observe", ["world"] = dir, ["handle"] = h.Handle });
                return (h.Handle, Answer: Safely(players[h.Handle], new Turn(round, observation)));
            }).ToList();
            // One deadline for the whole round: an answer that comes after it is dropped, not submitted later.
            var deadline = Task.Delay(timeoutMs);
            // The deadline is listed first, so when a stalled host sees both finished it still counts the answer as late.
            var settled = await Task.WhenAll(pending.Select(async p => (p.Handle, p.Answer, OnTime: await Task.WhenAny(deadline, p.Answer) == p.Answer)));
            foreach (var (handle, answer, onTime) in settled)
            {
                if (!onTime)
                {
                    dropped.Add(new Dropped(round, handle));
                    continue;
                }
                var value = answer.Result;
                var moves = value is JsonArray list ? list.Select(m => m!).ToList() : value is JsonObject ? [value] : new List<JsonNode>();
                foreach (var move in moves)
                {
                    Ok(
                        Call(new JsonObject { ["op"] = "player_submit", ["world"] = dir, ["handle"] = handle, ["move"] = move.DeepClone() }),
                        $"{handle} submit {(string?)move["command_id"]}");
                }
            }
            var closed = Call(new JsonObject { ["op"] = "director_close_round", ["world"] = dir });
            if ((string?)closed["status"] != "ok")
            {
                throw new InvalidOperationException($"round {round} refused: {(string?)closed["reason_code"] ?? (string?)closed["status"]}");
            }
        }
        var last = SnapshotOf();
        return new HostResult(round, last["run"]?["ended"]?["reason"]?.GetValue<string>(), dropped);
    }

    // A player that throws passes.
    private static async Task<JsonNode> Safely(Player player, Turn turn)
    {
        try
        {
            return await player(turn);
        }
        catch (Exception)
        {
            return JsonValue.Create("idle")!;
        }
    }

    private static string? RunState(JsonObject snapshot) => snapshot["run"]?["state"]?.GetValue<string>();

    // The names a scene gives its entities, which the plan uses for slots. The name must be unique in the world.
    private static string IdNamed(JsonObject snapshot, string name)
    {
        var ids = snapshot["entities"]!.AsObject().Where(pair => (string?)pair.Value!["name"] == name).Select(pair => pair.Key).ToList();
        return ids.Count == 1 ? ids[0] : throw new InvalidOperationException($"slot {name}: {ids.Count} entities carry that name");
    }

    // The scripted player a plan describes: its entry for the round, or its late answer, which arrives after the timeout.
    public static Player Scripted(JsonArray entries, int timeoutMs) => async turn =>
    {
        var entry = turn.Round < entries.Count ? entries[turn.Round] : null;
        if (entry is null || entry is JsonValue)
        {
            return JsonValue.Create("idle")!;
        }
        if (entry is JsonObject late && late["late"] is { } after)
        {
            await Task.Delay(timeoutMs * 3);
            return after.DeepClone();
        }
        return entry.DeepClone();
    };
}
