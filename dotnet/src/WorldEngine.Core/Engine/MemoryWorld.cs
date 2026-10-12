using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Engine.JsonReads;

namespace WorldEngine.Core.Engine;

// A world kept in memory (src/api.ts `memoryWorld`): its current snapshot, every snapshot it passed through for preemption, the
// events and per-command records since it started, and the attempts it took. It keeps no log, so it cannot replay its history
// before it started, and it has no roles or rounds yet. Its results are the same as a store world's (src/store/file-store.ts).
public sealed class MemoryWorld : IWorld, IWorldDriver
{
    // The reserved author that signs edits and time (src/engine/command.ts `WORLD_AUTHOR`).
    public const string WorldAuthor = Resolve.WorldAuthor;

    private readonly IReadOnlyDictionary<string, Template> registry;
    private readonly string templatesHash;
    private readonly IReadOnlyDictionary<string, string> names;
    private readonly Snapshot initial;
    private readonly long firstVersion;
    private Snapshot current;
    private long submissions;
    private readonly List<WorldEvent> events = [];
    private readonly Dictionary<long, Snapshot> history = [];
    private readonly List<Applied> applied = [];
    private readonly List<Attempt> tried = [];
    private long closedRoundCount;

    // The players' pending moves, held by this world and no other (`src/internal.ts` `INTERNAL`'s `pending`).
    public IPendingMoves Pending { get; } = new MemoryPendingMoves();

    // One accepted submission's record: the version it was based on, and what it changed and sensed.
    private sealed record Applied(long Base, IReadOnlyList<Delta> Deltas, IReadOnlyList<WorldEvent> Events);

    // A world over `snapshot`, which must be of the template set whose hash is `templatesHash` (`TemplateHash.Of`), and valid.
    public MemoryWorld(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string templatesHash,
        IReadOnlyDictionary<string, string>? names = null)
    {
        if (snapshot.TemplatesHash != templatesHash)
        {
            throw new WorldError("templates_changed", "Template hash mismatch");
        }
        var issues = SnapshotValidation.Validate(snapshot, registry);
        if (issues.Count > 0)
        {
            throw new WorldError("invalid_snapshot", $"Snapshot violates {issues[0].Code} ({issues.Count} issue(s))");
        }
        this.registry = registry;
        this.templatesHash = templatesHash;
        this.names = names ?? new Dictionary<string, string>();
        initial = snapshot;
        current = snapshot;
        firstVersion = snapshot.Version;
        history[snapshot.Version] = snapshot;
    }

    public Snapshot CurrentSnapshot() => current;

    public Entity? EntityOf(string id) => current.Entities.GetValueOrDefault(id);

    public string? Id(string name) => names.GetValueOrDefault(name);

    public IReadOnlyList<ScheduledCause> Scheduled() => Schedule.Scheduled(current);

    public IReadOnlyList<Catalog.CatalogEntry> CatalogEntries() => Catalog.Of(registry);

    // The same world, starting from its snapshot as it is now: its history begins here, and what either does afterwards the other
    // never sees.
    public MemoryWorld Fork() => new(current, registry, templatesHash, names);

    // One command as the world takes it. A command that carries the round flag or a role is refused as invalid, since the round
    // sets the first and a handle the second. With `observe`, the actor's view after the command is attached.
    Pipeline.Result IWorldDriver.Apply(Command command, long? basedOn) => Apply(command, basedOn, observe: false);

    public Pipeline.Result Apply(Command command, long? basedOn = null, bool observe = false)
    {
        if (IsFlagged(command))
        {
            return RoundFlagged(current, command);
        }
        var result = Submit(command, basedOn ?? current.Version, null);
        return WithObservation(command.Actor, result, observe);
    }

    // An edit is a command by the reserved author, so it is logged and replayed like one. Its id is `edit-<n>` unless given.
    public Pipeline.Result Edit(JsonObject edit, string? commandId = null, bool perceivers = false, By? by = null, long? basedOn = null)
    {
        var command = Submission.EditCommand(edit, commandId ?? $"edit-{submissions + 1}", perceivers, by);
        return Submit(command, basedOn ?? current.Version, null);
    }

    // A batch of commands, each decided against the same version (`beat`).
    public List<Pipeline.Result> Beat(IReadOnlyList<Command> commands, long? basedOn = null)
    {
        var baseVersion = basedOn ?? current.Version;
        var results = new List<Pipeline.Result>(commands.Count);
        foreach (var command in commands)
        {
            results.Add(IsFlagged(command) ? RoundFlagged(current, command) : Submit(command, baseVersion, null));
        }
        return results;
    }

    // What a dry run says a command would get now, with nothing logged: judged against the current version, so nothing is
    // preempted. An agent in a running run acts only as a move of a round.
    public Pipeline.Result Check(Command command) => DryRun(current, command);

    public Options.Result OptionsFor(string actor, bool refused) =>
        Options.List(current, registry, actor, refused, command => DryRun(current, command));

    // Every submission decided at that version or later, ok or not.
    public IReadOnlyList<Attempt> Attempts(long version)
    {
        CheckVersion(version);
        return tried.Where(attempt => attempt.Version >= version).ToList();
    }

    // The deltas and events of every accepted command since a version.
    public (List<Delta> Deltas, List<WorldEvent> Events) Since(long version)
    {
        CheckVersion(version);
        var deltas = new List<Delta>();
        var sinceEvents = new List<WorldEvent>();
        foreach (var record in applied)
        {
            if (record.Base >= version)
            {
                deltas.AddRange(record.Deltas);
                sinceEvents.AddRange(record.Events);
            }
        }
        return (deltas, sinceEvents);
    }

    // The fact half of a query, judged on the current snapshot.
    public Perception.Answer QueryFact(string subject, string relation, string? obj) =>
        Queries.Fact(current, registry, subject, relation, obj);

    // A perceive, by entity (the current snapshot) or by an event (the snapshots either side of the command that made it, when the
    // world has them, else the current one).
    public Perception.Answer QueryPerceive(string observer, string sense, string? eventId = null, string? entity = null)
    {
        if (eventId is null)
        {
            return Perception.Perceive(current, registry, observer, entity!, sense);
        }
        if (SnapshotAtEvent(eventId) is { } atEvent)
        {
            return Queries.AtEvent(atEvent.Before, atEvent.After, registry, atEvent.Events, observer, eventId, sense);
        }
        return EventPerception.Perceive(current, registry, events, observer, eventId, sense);
    }

    // What one observer could sense now, and, with `since` or `sinceTick`, which events after that version or at that tick it sensed.
    public JsonObject Observe(string observer, long? since = null, long? sinceTick = null) =>
        ObserveThrough(observer, since, sinceTick, tick =>
        {
            // Events of the world this one was made from, at its starting tick, are not in its records.
            if (firstVersion > 0 && tick <= initial.Tick)
            {
                throw new WorldError("history_unavailable", $"No records at tick {tick} or before {initial.Tick}");
            }
            return events.Where(@event => @event.Tick >= tick).ToList();
        });

    // One entity in detail, as the observer could sense it now; null when nothing of it is sensed.
    public JsonObject? Inspect(string observer, string entity)
    {
        if (!current.Entities.ContainsKey(observer))
        {
            throw new WorldError("no_such_entity", $"Unknown observer {observer}");
        }
        return Projection.InspectEntity(current, registry, [], observer, entity);
    }

    // What a trace of an event's chain or of a field gives: the events, or a refusal the memory world can give.
    public List<WorldEvent> TraceOf(string? eventId, string? entity, string? field)
    {
        if (eventId is not null)
        {
            return Trace.TraceEvent(events, eventId);
        }
        var allDeltas = applied.SelectMany(record => record.Deltas).ToList();
        var known = current.Entities.ContainsKey(entity!)
            || allDeltas.Any(delta => delta.Entity == entity)
            || events.Any(@event => @event.Entity == entity);
        if (!known)
        {
            throw new WorldError("no_such_entity", $"No such entity {entity}");
        }
        if (!Trace.ValidEntityFields.Contains(field!))
        {
            throw new WorldError("no_such_field", $"No such field {field}");
        }
        if (field != "entity")
        {
            var hasDelta = allDeltas.Any(delta => delta.Entity == entity && delta.Field == field);
            var hasSpawn = allDeltas.Any(delta => delta.Entity == entity && delta.Field == "entity");
            if (!hasDelta && !hasSpawn && initial.Entities.ContainsKey(entity!))
            {
                throw new WorldError("history_unavailable", $"No history for {entity}.{field} before this memory world was created");
            }
        }
        return Trace.TraceField(events, allDeltas, entity!, field!);
    }

    // The result a command gets now, judged as the world would judge it if it were sent: the same gate as a submission, with no
    // record, and with the round flag and the not-a-move rule for an agent in a running run.
    private Pipeline.Result DryRun(Snapshot snapshot, Command command)
    {
        if (snapshot.Run?.State == "running" && command.Actor != WorldAuthor)
        {
            return Round.IsRoundMove(VerbRegistry.All, command.Verb)
                ? Submission.ResolveSubmission(snapshot, registry, VerbRegistry.All, command with { Round = true }, snapshot.Version, _ => null)
                : Pipeline.Unchanged(snapshot, command, Status.Invalid, reasonCode: "not_a_round_move");
        }
        return Submission.ResolveSubmission(snapshot, registry, VerbRegistry.All, command, snapshot.Version, _ => null);
    }

    // Decides one command against the current version and logs its attempt; an accepted one moves the world on.
    private Pipeline.Result Submit(Command command, long basedOn, RoundMark? round)
    {
        submissions += 1;
        var baseVersion = current.Version;
        var result = Submission.ResolveSubmission(current, registry, VerbRegistry.All, command, basedOn, version => history.GetValueOrDefault(version));
        Record(Submission.AttemptOf(command, basedOn, baseVersion, result, round));
        if (result.Status == Status.Ok)
        {
            current = result.Snapshot;
            events.AddRange(result.Events);
            applied.Add(new Applied(baseVersion, result.Deltas, result.Events));
            history[current.Version] = current;
        }
        return result;
    }

    // A round of this world's history (`docs/rounds.md`): roles are allowed only in the director's close.
    public Round.Outcome TakeRound(IReadOnlyList<Command> moves) => RoundOf(moves, byAllowed: false);

    // The same round with the players' roles on its moves, closed by the director (`src/internal.ts` `roundAs`).
    public Round.Outcome TakeRoundAs(IReadOnlyList<Command> moves) => RoundOf(moves, byAllowed: true);

    private Round.Outcome RoundOf(IReadOnlyList<Command> moves, bool byAllowed)
    {
        if (!byAllowed && !moves.All(move => move.By is null))
        {
            return new Round.Outcome(Status.Invalid, "invalid_args", null, [], null);
        }
        var start = current;
        var plan = Round.PlanRound(start, registry, VerbRegistry.All, moves);
        if (plan.Status != Status.Ok)
        {
            return new Round.Outcome(plan.Status, plan.ReasonCode, null, [], null);
        }
        return Round.Play(
            moves,
            plan,
            closedRoundCount + 1,
            start.Version,
            (command, basedOn, mark, decided) => decided is null
                ? Submit(command, basedOn ?? current.Version, mark)
                : RecordDecided(command, basedOn ?? current.Version, decided, mark),
            byAllowed ? new By(Role.Director) : null);
    }

    // A move the plan refused where its round started: logged as refused, with no part in the world.
    private Pipeline.Result RecordDecided(Command command, long basedOn, Pipeline.Result decided, RoundMark mark)
    {
        submissions += 1;
        Record(Submission.AttemptOf(command, basedOn, current.Version, decided, mark));
        return decided;
    }

    // Keeps the attempt, and for a round's close, the count the next round is numbered from.
    private void Record(Attempt attempt)
    {
        tried.Add(attempt);
        if (attempt.Round?.Close == true)
        {
            closedRoundCount += 1;
        }
    }

    // Whether one of the observers sensed one of the events between the snapshots (`src/internal.ts` `heard`, `docs/roles.md`).
    public bool Heard(Snapshot before, Snapshot after, IReadOnlyList<WorldEvent> events, IReadOnlyList<string> observers) =>
        EventPerception.SensedBy(before, after, registry, events, events, observers);

    // A memory world keeps no log to replay, so it cannot verify one.
    public void Verify() => throw new WorldError("history_unavailable", "A memory world keeps no log to replay");

    // The result with the actor's view attached when the caller asked for it. An ok command moved the world one version, so its own
    // events are exactly those after the version before it.
    private Pipeline.Result WithObservation(string actor, Pipeline.Result result, bool observe)
    {
        if (!observe || !current.Entities.ContainsKey(actor))
        {
            return result;
        }
        var since = result.Status == Status.Ok ? result.Snapshot.Version - 1 : current.Version;
        return result with { Observation = ObserveThrough(actor, since, null, _ => []) };
    }

    // The projection of one observer: its entities from the current snapshot, and each event it could sense by a covered sense.
    private JsonObject ObserveThrough(string observer, long? since, long? sinceTick, Func<long, List<WorldEvent>> fromTick)
    {
        if (!current.Entities.ContainsKey(observer))
        {
            throw new WorldError("no_such_entity", $"Unknown observer {observer}");
        }
        if (sinceTick is { } tick)
        {
            if (since is not null)
            {
                throw new WorldError("invalid_tick", "Observe since a version or since a tick, not both");
            }
            if (tick < 0 || tick > MaxSafeInteger)
            {
                throw new WorldError("invalid_tick", $"Invalid tick {tick}");
            }
        }
        var covered = Capabilities.Senses.Where(sense => current.Coverage.Senses.Contains(sense)).ToList();
        List<WorldEvent> candidates = sinceTick is { } fromTickValue
            ? fromTick(fromTickValue)
            : since is null
                ? []
                : Since(since.Value).Events;

        var eventsSeen = new JsonArray();
        foreach (var @event in candidates)
        {
            var senses = new List<string>();
            var hearing = string.Empty;
            foreach (var sense in covered)
            {
                var answer = QueryPerceive(observer, sense, eventId: @event.EventId);
                if (answer.Value == "true")
                {
                    senses.Add(sense);
                    hearing = sense == "hearing" ? answer.BasisCode : hearing;
                }
            }
            if (senses.Count == 0)
            {
                continue;
            }
            var entry = new JsonObject
            {
                ["event_id"] = @event.EventId,
                ["tick"] = @event.Tick,
                ["type"] = @event.Type,
                ["senses"] = Strings(senses),
            };
            // One heard alone names where the sound came from and nobody; one heard alone from the next room names the door it came
            // through too. Anything sensed besides names its entity instead.
            if (senses is ["hearing"])
            {
                var from = Projection.HeardFrom(hearing);
                entry["from"] = from;
                if (from == "next_door" && Projection.HearingDoor(current, observer, @event) is { } door)
                {
                    entry["heard_from"] = door;
                }
            }
            else
            {
                entry["entity"] = @event.Entity;
            }
            if (@event.Type == "say" && senses.Contains("hearing") && Text(@event.Data.GetValueOrDefault("utterance")) is { } utterance)
            {
                entry["utterance"] = utterance;
                entry["volume"] = VolumeText(@event.Data.GetValueOrDefault("volume"));
            }
            eventsSeen.Add(entry);
        }

        return new JsonObject
        {
            ["observer"] = observer,
            ["version"] = current.Version,
            ["unknown_senses"] = Strings(Capabilities.Senses.Where(sense => !covered.Contains(sense))),
            ["entities"] = new JsonArray(Projection.ObserveEntities(current, registry, [], observer).Select(entity => (JsonNode?)entity).ToArray()),
            ["events"] = eventsSeen,
        };
    }

    // The snapshots either side of the command that produced an event, and the events up to and including it.
    private (Snapshot Before, Snapshot After, List<WorldEvent> Events)? SnapshotAtEvent(string eventId)
    {
        var collected = new List<WorldEvent>();
        foreach (var record in applied)
        {
            collected.AddRange(record.Events);
            if (record.Events.Any(@event => @event.EventId == eventId))
            {
                return history.TryGetValue(record.Base, out var before) && history.TryGetValue(record.Base + 1, out var after)
                    ? (before, after, collected)
                    : null;
            }
        }
        return null;
    }

    private void CheckVersion(long version)
    {
        if (version < 0 || version > MaxSafeInteger)
        {
            throw new WorldError("invalid_version", $"Invalid version {version}");
        }
        if (version < firstVersion)
        {
            throw new WorldError("history_unavailable", $"No records before version {firstVersion}");
        }
        if (version > current.Version)
        {
            throw new WorldError("future_version", $"Version {version} is ahead of {current.Version}");
        }
    }

    // A command that carries the round flag or a role is not a caller's to send (`isFlagged`).
    private static bool IsFlagged(Command command) => command.Round == true || command.By is not null;

    private static Pipeline.Result RoundFlagged(Snapshot snapshot, Command command) =>
        Pipeline.Unchanged(snapshot, command, Status.Invalid, reasonCode: "invalid_args");

    // What a view says of a volume: the text of it, as a string written in a log reads (`String(value)` of an absent one is "undefined").
    private static string VolumeText(JsonNode? volume) => volume switch
    {
        null => "undefined",
        JsonValue value when value.TryGetValue(out string? text) => text,
        _ => volume.ToJsonString(),
    };

    private static JsonArray Strings(IEnumerable<string> values) =>
        new(values.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());

    private const long MaxSafeInteger = 9007199254740991;
}
