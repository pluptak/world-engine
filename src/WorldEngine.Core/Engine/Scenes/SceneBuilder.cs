using System.Text.Json.Nodes;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Engine.JsonReads;

namespace WorldEngine.Core.Engine;

// The scene builder (src/engine/scene.ts `sceneSnapshot`): a scene's beats and run, put on the snapshot its spawns made. A
// scene's beats name entities by scenario name, which is replaced by the id it names. A refusal names its path (`beats[2]`,
// `beats[0].then[1]`, `run.slots[0]`) and its rule, and nothing is written: the world is created only after this.
public static class SceneBuilder
{
    // Keys whose string value names an entity, and props whose string value names one (src/engine/scene.ts, src/scenario.ts).
    private static readonly HashSet<string> ReferenceKeys =
        ["entity", "target", "in", "room", "location", "support", "contained_in", "concealed_by"];

    // The scene's beats and run on the snapshot its spawns made, with names bound to ids. A null beats or run is absent from the
    // scene. The beats are schedule_beat bodies, and the pool beats are beat bodies with no tick.
    public static Snapshot Build(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, string> names,
        JsonArray? beats,
        JsonObject? run)
    {
        var withBeats = beats is null ? snapshot : QueueBeats(snapshot, registry, names, beats);
        return run is null ? withBeats : SceneRun(withBeats, registry, names, run);
    }

    private static WorldError Refused(string path, Code rule) => new(Code.InvalidScenario, $"{path}: {WorldJson.Name(rule)}");

    private static string Named(IReadOnlyDictionary<string, string> names, string name, string path) =>
        names.TryGetValue(name, out var id) ? id : throw Refused(path, Code.NoSuchEntity);

    // The body with every name it reads replaced by the id it names, wherever it holds one: an action's target, a condition's
    // entity or room, a follower's action and condition.
    private static JsonNode? ResolveBody(JsonNode? value, IReadOnlyDictionary<string, string> names, string path)
    {
        switch (value)
        {
            case JsonArray array:
            {
                var items = new JsonArray();
                for (var index = 0; index < array.Count; index++)
                {
                    items.Add(ResolveBody(array[index], names, $"{path}[{index}]"));
                }
                return items;
            }
            case JsonObject obj:
            {
                var body = new JsonObject();
                foreach (var (key, field) in obj)
                {
                    var at = $"{path}.{key}";
                    if (Text(field) is { } name && ReferenceKeys.Contains(key))
                    {
                        body[key] = JsonValue.Create(Named(names, name, at));
                    }
                    else if (key == "props" && field is JsonObject props)
                    {
                        body[key] = ResolveProps(props, names, at);
                    }
                    else
                    {
                        body[key] = ResolveBody(field, names, at);
                    }
                }
                return body;
            }
            default:
                return value?.DeepClone();
        }
    }

    private static JsonObject ResolveProps(JsonObject props, IReadOnlyDictionary<string, string> names, string path)
    {
        var resolved = new JsonObject();
        foreach (var (key, value) in props)
        {
            resolved[key] = Text(value) is { } name && Prop.References.Contains(key)
                ? JsonValue.Create(Named(names, name, $"{path}.{key}"))
                : value?.DeepClone();
        }
        return resolved;
    }

    // Every subject a beat and its followers act on is an entity of the world, and every prop one writes is one its template
    // holds, checked as a schedule_beat would check them.
    private static string SubjectOf(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        JsonObject action,
        JsonArray? then,
        string path)
    {
        var subject = Beats.ActionSubject(action);
        if (subject is null || !snapshot.Entities.ContainsKey(subject))
        {
            throw Refused(path, Code.NoSuchEntity);
        }
        if (Beats.PropRefusal(snapshot, registry, action) is { } code)
        {
            throw Refused(path, code);
        }
        for (var index = 0; then is not null && index < then.Count; index++)
        {
            var child = (JsonObject)then[index]!;
            SubjectOf(snapshot, registry, (JsonObject)child["action"]!, child["then"] as JsonArray, $"{path}.then[{index}]");
        }
        return subject;
    }

    // Each beat is checked as a schedule_beat would be, against the entities the scene made, and queued with no cause: no event
    // set it going, so its cause is null, as a process the initial state started.
    private static Snapshot QueueBeats(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, string> names,
        JsonArray beats)
    {
        var next = snapshot;
        var taken = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < beats.Count; index++)
        {
            var path = $"beats[{index}]";
            if (beats[index] is not JsonObject body)
            {
                throw Refused(path, Code.InvalidBeat);
            }
            var resolved = (JsonObject)ResolveBody(body, names, path)!;
            resolved["kind"] = JsonValue.Create("schedule_beat");
            if (!Beats.ParseScheduleBeat(resolved))
            {
                throw Refused(path, Code.InvalidBeat);
            }
            var atTick = SafeInt(resolved["at_tick"])!.Value;
            if (atTick < 1)
            {
                throw Refused(path, Code.BeatInPast);
            }
            var subject = SubjectOf(next, registry, (JsonObject)resolved["action"]!, resolved["then"] as JsonArray, path);
            foreach (var id in Beats.EditIds(resolved))
            {
                if (!taken.Add(id))
                {
                    throw Refused(path, Code.DuplicateBeat);
                }
            }
            if (taken.Count > Beats.MaxBeats)
            {
                throw Refused(path, Code.TooManyBeats);
            }
            var cause = Beats.CauseOf(resolved, atTick, subject, null);
            next = AddCause(next, cause);
        }
        return next;
    }

    // A pool beat is a beat body with no tick: checked as a beat is, and its id unique among the beats the scene queued and the
    // pool's own (`docs/beats.md`). It is kept for the director to play.
    private static List<JsonObject> ScenePool(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, string> names,
        JsonArray bodies,
        IEnumerable<string> taken)
    {
        var used = new HashSet<string>(taken, StringComparer.Ordinal);
        var pool = new List<JsonObject>(bodies.Count);
        for (var index = 0; index < bodies.Count; index++)
        {
            var path = $"run.pool[{index}]";
            if (bodies[index] is not JsonObject body || body.ContainsKey("at_tick"))
            {
                throw Refused(path, Code.InvalidBeat);
            }
            var resolved = (JsonObject)ResolveBody(body, names, path)!;
            // The tick is a placeholder the shape check needs; a pool beat is played at a tick the director names.
            resolved["at_tick"] = JsonValue.Create(1L);
            resolved["kind"] = JsonValue.Create("schedule_beat");
            if (!Beats.ParseScheduleBeat(resolved))
            {
                throw Refused(path, Code.InvalidBeat);
            }
            SubjectOf(snapshot, registry, (JsonObject)resolved["action"]!, resolved["then"] as JsonArray, path);
            foreach (var id in Beats.EditIds(resolved))
            {
                if (!used.Add(id))
                {
                    throw Refused(path, Code.DuplicateBeat);
                }
            }
            var entry = new JsonObject
            {
                ["id"] = resolved["id"]!.DeepClone(),
                ["action"] = resolved["action"]!.DeepClone(),
            };
            if (resolved["only_if"] is { } onlyIf)
            {
                entry["only_if"] = onlyIf.DeepClone();
            }
            if (resolved["then"] is { } then)
            {
                entry["then"] = then.DeepClone();
            }
            if (resolved["repeat"] is { } repeat)
            {
                entry["repeat"] = repeat.DeepClone();
            }
            pool.Add(entry);
        }
        return pool;
    }

    // A door's odds are steered within a range the scene sets, which must be a whole range from 0 to 100 (`docs/roles.md`).
    private static List<Odds> SceneOdds(Snapshot snapshot, IReadOnlyDictionary<string, string> names, JsonArray odds)
    {
        var result = new List<Odds>(odds.Count);
        for (var index = 0; index < odds.Count; index++)
        {
            var entry = (JsonObject)odds[index]!;
            var path = $"run.odds[{index}]";
            var entity = Named(names, Text(entry["entity"]) ?? "", $"{path}.entity");
            if (!(snapshot.Entities.TryGetValue(entity, out var door)
                && door.Props.Get(Prop.Open) is not null))
            {
                throw Refused($"{path}.entity", Code.NotADoor);
            }
            if (SafeInt(entry["min"]) is not { } min || SafeInt(entry["max"]) is not { } max
                || !InRange(min) || !InRange(max) || min > max)
            {
                throw Refused(path, Code.InvalidOdds);
            }
            result.Add(new Odds(entity, Prop.JamPct, min, max));
        }
        return result;
    }

    private static bool InRange(long value) => value >= 0 && value <= 100;

    // A run names a limit, its slots, a pool or odds: a positive tick limit, agents that are its slots, beats for the director to
    // play, and the odds it may steer. A run with none of these is no run to end or steer.
    private static Snapshot SceneRun(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, IReadOnlyDictionary<string, string> names, JsonObject run)
    {
        var tickNode = run["tick_limit"];
        var slotsNode = run["slots"] as JsonArray;
        var poolNode = run["pool"] as JsonArray;
        var oddsNode = run["odds"] as JsonArray;
        if (tickNode is null && slotsNode is null && poolNode is null && oddsNode is null)
        {
            throw Refused("run", Code.EmptyRun);
        }
        if (tickNode is not null && (SafeInt(tickNode) is not { } limit || limit < 1))
        {
            throw Refused("run.tick_limit", Code.InvalidRun);
        }
        if (slotsNode is { Count: 0 })
        {
            throw Refused("run.slots", Code.InvalidRun);
        }

        // A slot is one id, or a list of several named bodies; a list of one is stored as its id.
        var slots = new List<JsonNode>();
        var bodies = new List<string>();
        for (var index = 0; slotsNode is not null && index < slotsNode.Count; index++)
        {
            var entry = slotsNode[index];
            var path = $"run.slots[{index}]";
            var group = entry is JsonArray;
            List<string?> members = entry is JsonArray list ? [.. list.Select(Text)] : [Text(entry)];
            if (members.Count == 0)
            {
                throw Refused(path, Code.InvalidRun);
            }
            var ids = new List<string>(members.Count);
            for (var member = 0; member < members.Count; member++)
            {
                var name = members[member] ?? throw Refused(path, Code.InvalidRun);
                var memberPath = group ? $"{path}[{member}]" : path;
                var id = Named(names, name, memberPath);
                if (!Reach.IsAgent(snapshot, id))
                {
                    throw Refused(memberPath, Code.NotAnAgent);
                }
                if (bodies.Contains(id))
                {
                    throw Refused(memberPath, Code.DuplicateSlot);
                }
                bodies.Add(id);
                ids.Add(id);
            }
            slots.Add(ids.Count == 1
                ? (JsonNode)JsonValue.Create(ids[0])!
                : new JsonArray([.. ids.Select(id => (JsonNode?)JsonValue.Create(id))]));
        }

        var pool = poolNode is null
            ? null
            : ScenePool(snapshot, registry, names, poolNode, Beats.PendingBeatIds(Schedule.Pending(snapshot)));
        var odds = oddsNode is null ? null : SceneOdds(snapshot, names, oddsNode);
        return snapshot with
        {
            Run = new Run(
                "registering",
                TickLimit: tickNode is null ? null : SafeInt(tickNode),
                Slots: slotsNode is null ? null : slots,
                Pool: pool,
                Odds: odds),
        };
    }

    // Adds a cause to the schedule in run order, as the world does (src/engine/pending.ts `withCause`).
    private static Snapshot AddCause(Snapshot snapshot, ScheduledCause cause)
    {
        var working = new Working(snapshot, "scene");
        Schedule.Add(working, cause);
        return working.Snapshot;
    }
}
