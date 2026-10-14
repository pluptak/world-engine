using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

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
        Value.List? beats,
        Value.Map? run)
    {
        var withBeats = beats is null ? snapshot : QueueBeats(snapshot, registry, names, beats);
        return run is null ? withBeats : SceneRun(withBeats, registry, names, run);
    }

    private static WorldError Refused(string path, Code rule) => new(Code.InvalidScenario, $"{path}: {WorldJson.Name(rule)}");

    private static string Named(IReadOnlyDictionary<string, string> names, string name, string path) =>
        names.TryGetValue(name, out var id) ? id : throw Refused(path, Code.NoSuchEntity);

    // The body with every name it reads replaced by the id it names, wherever it holds one: an action's target, a condition's
    // entity or room, a follower's action and condition.
    private static Value ResolveBody(Value value, IReadOnlyDictionary<string, string> names, string path)
    {
        switch (value)
        {
            case Value.List list:
                return Value.Of(list.Items.Select((item, index) => ResolveBody(item, names, $"{path}[{index}]")));
            case Value.Map map:
            {
                var body = Value.Map.Empty;
                foreach (var (key, field) in map)
                {
                    var at = $"{path}.{key}";
                    body = body.With(key, field switch
                    {
                        Value.Text name when ReferenceKeys.Contains(key) => Named(names, name.Content, at),
                        Value.Map props when key == "props" => ResolveProps(props, names, at),
                        _ => ResolveBody(field, names, at),
                    });
                }
                return body;
            }
            default:
                return value;
        }
    }

    private static Value.Map ResolveProps(Value.Map props, IReadOnlyDictionary<string, string> names, string path) =>
        Value.Of(props.Select(pair => KeyValuePair.Create(
            pair.Key,
            (Value?)(pair.Value is Value.Text name && Prop.References.Contains(pair.Key) ? Named(names, name.Content, $"{path}.{pair.Key}") : pair.Value))));

    // Every subject a beat and its followers act on is an entity of the world, and every prop one writes is one its template
    // holds, checked as a schedule_beat would check them.
    private static void CheckSubjects(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        Value.Map action,
        IReadOnlyList<BeatFollower>? then,
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
            CheckSubjects(snapshot, registry, then[index].Action, then[index].Then, $"{path}.then[{index}]");
        }
    }

    // Each beat is checked as a schedule_beat would be, against the entities the scene made, and queued with no cause: no event
    // set it going, so its cause is null, as a process the initial state started.
    private static Snapshot QueueBeats(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, string> names,
        Value.List beats)
    {
        var next = snapshot;
        var taken = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < beats.Items.Length; index++)
        {
            var path = $"beats[{index}]";
            if (beats.Items[index] is not Value.Map body)
            {
                throw Refused(path, Code.InvalidBeat);
            }
            var resolved = ((Value.Map)ResolveBody(body, names, path)).With("kind", "schedule_beat");
            var cause = Beats.ScheduleBeatOf(resolved) ?? throw Refused(path, Code.InvalidBeat);
            if (cause.DueTick < 1)
            {
                throw Refused(path, Code.BeatInPast);
            }
            CheckSubjects(next, registry, cause.Action, cause.Then, path);
            foreach (var id in Beats.Ids(cause.Id, cause.Then))
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
            next = AddCause(next, cause);
        }
        return next;
    }

    // A pool beat is a beat body with no tick: checked as a beat is, and its id unique among the beats the scene queued and the
    // pool's own (`docs/beats.md`). It is kept for the director to play.
    private static List<PoolBeat> ScenePool(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, string> names,
        Value.List bodies,
        IEnumerable<string> taken)
    {
        var used = new HashSet<string>(taken, StringComparer.Ordinal);
        var pool = new List<PoolBeat>(bodies.Items.Length);
        for (var index = 0; index < bodies.Items.Length; index++)
        {
            var path = $"run.pool[{index}]";
            if (bodies.Items[index] is not Value.Map body || body.ContainsKey("at_tick"))
            {
                throw Refused(path, Code.InvalidBeat);
            }
            // The tick is a placeholder the shape check needs; a pool beat is played at a tick the director names.
            var resolved = ((Value.Map)ResolveBody(body, names, path)).With("at_tick", 1L).With("kind", "schedule_beat");
            var beat = Beats.PoolBeatOf(Beats.ScheduleBeatOf(resolved) ?? throw Refused(path, Code.InvalidBeat));
            CheckSubjects(snapshot, registry, beat.Action, beat.Then, path);
            foreach (var id in Beats.Ids(beat.Id, beat.Then))
            {
                if (!used.Add(id))
                {
                    throw Refused(path, Code.DuplicateBeat);
                }
            }
            pool.Add(beat);
        }
        return pool;
    }

    // A door's odds are steered within a range the scene sets, which must be a whole range from 0 to 100 (`docs/roles.md`).
    private static List<Odds> SceneOdds(Snapshot snapshot, IReadOnlyDictionary<string, string> names, Value.List odds)
    {
        var result = new List<Odds>(odds.Items.Length);
        for (var index = 0; index < odds.Items.Length; index++)
        {
            var entry = (Value.Map)odds.Items[index];
            var path = $"run.odds[{index}]";
            var entity = Named(names, entry.GetValueOrDefault("entity").AsText() ?? "", $"{path}.entity");
            if (!(snapshot.Entities.TryGetValue(entity, out var door)
                && door.Props.Get(Prop.Open) is not null))
            {
                throw Refused($"{path}.entity", Code.NotADoor);
            }
            if (entry.GetValueOrDefault("min").AsInt() is not { } min || entry.GetValueOrDefault("max").AsInt() is not { } max
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
    private static Snapshot SceneRun(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, IReadOnlyDictionary<string, string> names, Value.Map run)
    {
        var tickNode = run.GetValueOrDefault("tick_limit");
        var slotsNode = run.GetValueOrDefault("slots") as Value.List;
        var poolNode = run.GetValueOrDefault("pool") as Value.List;
        var oddsNode = run.GetValueOrDefault("odds") as Value.List;
        if (tickNode is null && slotsNode is null && poolNode is null && oddsNode is null)
        {
            throw Refused("run", Code.EmptyRun);
        }
        if (tickNode is not null && (tickNode.AsInt() is not { } limit || limit < 1))
        {
            throw Refused("run.tick_limit", Code.InvalidRun);
        }
        if (slotsNode is { Items.Length: 0 })
        {
            throw Refused("run.slots", Code.InvalidRun);
        }

        // A slot is one id, or a list of several named bodies; a list of one is stored as its id.
        var slots = new List<Value>();
        var bodies = new List<string>();
        for (var index = 0; slotsNode is not null && index < slotsNode.Items.Length; index++)
        {
            var entry = slotsNode.Items[index];
            var path = $"run.slots[{index}]";
            var group = entry is Value.List;
            List<string?> members = entry is Value.List list ? [.. list.Items.Select(item => item.AsText())] : [entry.AsText()];
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
            slots.Add(ids.Count == 1 ? ids[0] : Value.Of(ids.Select(id => (Value)id)));
        }

        var pool = poolNode is null
            ? null
            : ScenePool(snapshot, registry, names, poolNode, Beats.PendingBeatIds(Schedule.Pending(snapshot)));
        var odds = oddsNode is null ? null : SceneOdds(snapshot, names, oddsNode);
        return snapshot with
        {
            Run = new Run(
                "registering",
                TickLimit: tickNode.AsInt(),
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
