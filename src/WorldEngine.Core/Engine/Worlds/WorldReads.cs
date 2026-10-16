using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The reads a view makes of a world (src/api.ts `World`, `src/internal.ts`): a dry run, an observer's projection and an entity in detail.
// Each is written against what a world can say of itself (IWorldReads), so a memory world and a stored world answer alike.
public static class WorldReads
{
    // The result a command gets now, judged as the world would judge it if it were sent: the same gate as a submission, with no
    // record, and with the round flag and the not-a-move rule for an agent in a running run.
    public static Pipeline.Result DryRun(IReadOnlyDictionary<string, Template> registry, Snapshot snapshot, Command command)
    {
        if (snapshot.Run?.State == "running" && command.Actor != Resolve.WorldAuthor)
        {
            return Round.IsRoundMove(VerbRegistry.All, command.Verb)
                ? Submission.ResolveSubmission(snapshot, registry, VerbRegistry.All, command with { Round = true }, snapshot.Version, _ => null)
                : Pipeline.Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.NotARoundMove);
        }
        return Submission.ResolveSubmission(snapshot, registry, VerbRegistry.All, command, snapshot.Version, _ => null);
    }

    // The projection of one observer: its entities from the current snapshot, and each event it could sense by a covered sense.
    public static Projection.Observation Observe(IWorldReads world, string observer, long? since, long? sinceTick, Func<long, List<WorldEvent>> fromTick)
    {
        var current = world.CurrentSnapshot();
        var registry = world.Registry;
        if (!current.Entities.ContainsKey(observer))
        {
            throw new WorldError(Code.NoSuchEntity, $"Unknown observer {observer}");
        }
        if (sinceTick is { } tick)
        {
            if (since is not null)
            {
                throw new WorldError(Code.InvalidTick, "Observe since a version or since a tick, not both");
            }
            if (tick < 0)
            {
                throw new WorldError(Code.InvalidTick, $"Invalid tick {tick}");
            }
        }
        var covered = Capabilities.Senses.Where(sense => current.Coverage.Senses.Contains(sense)).ToList();
        List<WorldEvent> candidates = sinceTick is { } fromTickValue
            ? fromTick(fromTickValue)
            : since is null
                ? []
                : world.Since(since.Value).Events;

        var eventsSeen = new List<Projection.SensedEvent>();
        foreach (var @event in candidates)
        {
            var senses = new List<string>();
            Code? hearing = null;
            foreach (var sense in covered)
            {
                var answer = world.PerceiveAtEvent(observer, sense, @event.EventId);
                if (answer.Value == Truth.True)
                {
                    senses.Add(sense);
                    hearing = sense == Sense.Hearing ? answer.BasisCode : hearing;
                }
            }
            if (senses.Count == 0)
            {
                continue;
            }
            var entry = new Projection.SensedEvent(@event.EventId, @event.Tick, @event.Type, senses);
            // One heard alone names where the sound came from and nobody; one heard alone from the next room names the door it came
            // through too. Anything sensed besides names its entity instead.
            if (senses is [Sense.Hearing])
            {
                var from = Projection.HeardFrom(hearing!.Value);
                entry = entry with
                {
                    From = from,
                    HeardFrom = from == "next_door" ? Projection.HearingDoor(current, observer, @event) : null,
                };
            }
            else
            {
                entry = entry with { Entity = @event.Entity };
            }
            if (@event.Type == "say" && senses.Contains(Sense.Hearing) && @event.Data.GetValueOrDefault("utterance").AsText() is { } utterance)
            {
                entry = entry with { Utterance = utterance, Volume = @event.Data.GetValueOrDefault("volume").AsText() };
            }
            eventsSeen.Add(entry);
        }

        return new Projection.Observation(
            observer,
            current.Version,
            [.. Capabilities.Senses.Where(sense => !covered.Contains(sense))],
            Projection.ObserveEntities(current, registry, [], observer),
            eventsSeen);
    }

    // One entity in detail, as the observer could sense it now; null when nothing of it is sensed.
    public static Projection.Inspection? Inspect(IWorldReads world, string observer, string entity)
    {
        var current = world.CurrentSnapshot();
        if (!current.Entities.ContainsKey(observer))
        {
            throw new WorldError(Code.NoSuchEntity, $"Unknown observer {observer}");
        }
        return Projection.InspectEntity(current, world.Registry, [], observer, entity);
    }

    // The result with the actor's view attached when the caller asked for it. An ok command moved the world one version, so its own
    // events are exactly those after the version before it.
    public static Pipeline.Result WithObservation(IWorldReads world, string actor, Pipeline.Result result, bool observe)
    {
        if (!observe)
        {
            return result;
        }
        var current = world.CurrentSnapshot();
        if (!current.Entities.ContainsKey(actor))
        {
            return result;
        }
        var since = result.Status == Status.Ok ? result.Snapshot.Version - 1 : current.Version;
        return result with { Observation = Observe(world, actor, since, null, _ => []) };
    }

    // Whether a command carries a flag only a round or a handle may set, which a plain submission refuses.
    public static bool IsFlagged(Command command) => command.Round == true || command.By is not null;

    public static Pipeline.Result RoundFlagged(Snapshot snapshot, Command command) =>
        Pipeline.Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.InvalidArgs);

}
