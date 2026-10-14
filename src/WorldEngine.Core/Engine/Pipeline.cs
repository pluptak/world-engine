using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// A command's transition (src/engine/pipeline.ts `apply`). `Screen` is the front of it: what the command names and
// whether its actor can act at all. A command that fails there never reaches a verb, so its result is decided by the
// world alone, and `Screen` returns null for a command that would go on to the verb's preconditions, the root event, the
// transition and the clock.
public static class Pipeline
{
    // What a verb declares: whether it needs a target, whether only the world author may issue it, its preconditions
    // (null when it has none beyond the front), its duration (null is one tick), the capacities its actor must hold
    // (`requires`), and its transition, run after the root event (null when it changes nothing).
    public sealed record VerbDecl(
        bool RequiresTarget,
        bool AuthorOnly,
        Func<CommandContext, Refusal?>? Preconditions = null,
        VerbDuration? Duration = null,
        IReadOnlyList<Requirement>? Requires = null,
        Action<Working, CommandContext, string?>? Transition = null,
        Func<CommandContext, (string Entity, Value.Map Data)>? RootEvent = null,
        Func<Command, IReadOnlyList<string>>? WakeOn = null,
        // Judges the snapshot the transition and the clock left (src/engine/pipeline.ts `validateResult`): a refusal
        // returns the input snapshot unchanged. Null when the verb has no such check.
        Func<CommandContext, Refusal?>? ValidateResult = null,
        // Where the time a command passes stops short: the beat `stop_before` names, as pending when the command is decided
        // (src/engine/command.ts `stop_before`). Null when the verb has none.
        Func<Command, Snapshot, Clock.StopBeat?>? StopBefore = null,
        // Whether the verb takes exactly one tick whatever its args (src/engine/clock.ts `isOneTickVerb`): a round's move, which
        // takes no time of its own (`docs/rounds.md`), is one of these.
        bool OneTick = false,
        // The arg sets an option lists for a verb that needs args, given the actor's targets (src/engine/command.ts `suggest`).
        // Null when the verb suggests none.
        Func<CommandContext, IReadOnlyList<string>, IReadOnlyList<Value.Map>>? Suggest = null,
        // Whether the verb takes args that no list holds, so it stays among the verbs that need args (`free_args`).
        bool FreeArgs = false,
        // Whether the verb is tried at each part of the body it names (`aims_at_parts`, used by `options`).
        bool AimsAtParts = false);

    // A capacity the actor must hold at least `AtLeast` of before the verb runs.
    public sealed record Requirement(string Capacity, long AtLeast);

    // What a verb's preconditions and transition read: the command, the world it runs in, the target the command
    // resolved to (null when it names none), and the verb's requirements.
    public sealed record CommandContext(
        Snapshot Snapshot,
        IReadOnlyDictionary<string, Template> Registry,
        Command Command,
        Resolve.TargetAddress? Target,
        IReadOnlyList<Requirement> Requires);

    // A verb's refusal of a command at its preconditions, before anything changes.
    // A refusal with a reason code, or an unresolved or ambiguous destination, which has none; an ambiguous one names its
    // candidates.
    public sealed record Refusal(
        Status Status,
        Code? ReasonCode,
        Value.Map? ReasonData = null,
        IReadOnlyList<string>? Candidates = null);

    // A refusal of a command that is well formed but cannot be done now, with its reason code (and data, when it has some).
    public static Refusal Refused(Code code, Value.Map? data = null) => new(Status.Refused, code, data);

    // The refusal of a body short of a capacity: `insufficient_manipulation` for `manipulation`.
    public static Code Insufficient(string capacity) => capacity switch
    {
        Capacity.Manipulation => Code.InsufficientManipulation,
        Capacity.Moving => Code.InsufficientMoving,
        Capacity.Speech => Code.InsufficientSpeech,
        _ => throw new InvalidOperationException($"No refusal names a body short of {capacity}"),
    };

    // What a log or a skipped beat names as the reason: the code, or the status where there is none (`ambiguous`).
    public static string ReasonName(Code? reasonCode, Status status) =>
        reasonCode is { } code ? WorldJson.Name(code) : WorldJson.Name(status);

    // A refusal of a command that names something the world does not hold or is malformed, with its reason code.
    public static Refusal Invalid(Code code) => new(Status.Invalid, code);

    // Reason data or an event's data, from pairs of a key and what code holds there (`Value.From`); a null value leaves its key
    // out.
    public static Value.Map Reason(params (string Key, object? Value)[] pairs) =>
        Value.Of(pairs.Select(pair => KeyValuePair.Create(pair.Key, Value.From(pair.Value))));

    // The refusal for an actor short of a required capacity (src/engine/carry.ts `capacityRefusal`): the code names the
    // verb's first requirement, and the data the first one unmet. Null when the actor meets them all.
    public static Refusal? RequirementRefusal(CommandContext context)
    {
        if (context.Requires.Count == 0)
        {
            return null;
        }
        var caps = Capacities.All(context.Snapshot, context.Registry, context.Command.Actor);
        static long Have(IReadOnlyDictionary<string, long>? caps, string capacity) =>
            caps is not null && caps.TryGetValue(capacity, out var level) ? level : 0;

        var unmet = context.Requires.FirstOrDefault(requirement => Have(caps, requirement.Capacity) < requirement.AtLeast);
        if (unmet is null)
        {
            return null;
        }
        var data = Reason(("capacity", unmet.Capacity), ("have", Have(caps, unmet.Capacity)), ("need", unmet.AtLeast));
        return new Refusal(Status.Refused, Insufficient(context.Requires[0].Capacity), data);
    }

    public sealed record Result(
        Status Status,
        string CommandId,
        string? ResolvedTarget,
        IReadOnlyList<string>? Candidates,
        Code? ReasonCode,
        Value.Map? ReasonData,
        Snapshot Snapshot,
        IReadOnlyList<Delta> Deltas,
        IReadOnlyList<WorldEvent> Events,
        // With `observe`: what the actor could sense afterwards.
        Projection.Observation? Observation = null);

    // The result of a command the front refuses, which leaves the snapshot as it was.
    public static Result Unchanged(
        Snapshot snapshot,
        Command command,
        Status status,
        string? resolvedTarget = null,
        Code? reasonCode = null,
        IReadOnlyList<string>? candidates = null,
        Value.Map? reasonData = null) =>
        new(status, command.CommandId, resolvedTarget, candidates, reasonCode, reasonData, snapshot, [], []);

    // The front's verdict on a command: a refusal result, or null when the command goes on to its verb.
    public static Result? Screen(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, VerbDecl> verbs,
        Command command)
    {
        if (!verbs.TryGetValue(command.Verb, out var verb))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.UnknownVerb);
        }

        var authored = command.Actor == Resolve.WorldAuthor && verb.AuthorOnly;
        if (!authored && !snapshot.Entities.ContainsKey(command.Actor))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.NoSuchActor);
        }
        if (!authored && !Reach.IsAgent(snapshot, command.Actor))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.NotAnAgent);
        }
        // A run's state takes some commands (`docs/run.md`). The world's, not a verb's, so no verb declares it.
        if (Runs.RunRefusal(snapshot, command.Verb, authored, command.Round == true) is { } runCode)
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: runCode);
        }

        // An agent a controller runs acts only while its control walk carries the command, and one with a
        // `powered_by` only while it has power.
        if (!authored && Power.AgentFault(snapshot, command.Actor) is { } fault)
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: fault.ReasonCode, reasonData: fault.ReasonData);
        }
        // A command sent for another agent is the body's controller's to send, and no one else's.
        if (command.Via is { } via)
        {
            if (!snapshot.Entities.ContainsKey(via))
            {
                return Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.NoSuchActor);
            }
            if (!Reach.IsAgent(snapshot, via))
            {
                return Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.NotAnAgent);
            }
            if (Power.Controller(snapshot, command.Actor) != via && Possession.Holder(snapshot, command.Actor) != via)
            {
                return Unchanged(snapshot, command, Status.Refused, reasonCode: Code.NotController);
            }
        }
        // A sleeping body makes no command of its own; the world author may still act on it.
        var actor = snapshot.Entities.GetValueOrDefault(command.Actor);
        if (!authored && actor is not null && actor.Props.Is(Prop.Asleep))
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: Code.Asleep);
        }
        if (!authored && actor is not null && actor.Props.Is(Prop.Unconscious))
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: Code.Unconscious);
        }
        // A possessed body acts only at its possessor's word, sent with `via`.
        if (!authored && Possession.Holder(snapshot, command.Actor) is { } holder && command.Via != holder)
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: Code.Possessed);
        }

        if (command.Target is not null)
        {
            var resolution = Resolve.ResolveTarget(snapshot, registry, command.Actor, command.Target);
            switch (resolution)
            {
                case Resolve.Unresolved:
                    return Unchanged(snapshot, command, Status.Unresolved);
                case Resolve.Ambiguous ambiguous:
                    return Unchanged(snapshot, command, Status.Ambiguous, candidates: ambiguous.Candidates);
                case Resolve.Resolved resolved:
                    // Nothing an agent does reaches scenery; the world author's edits may still change it.
                    if (!authored && Resolve.IsScenery(registry, snapshot.Entities[resolved.Target.EntityId]))
                    {
                        return Unchanged(snapshot, command, Status.Refused, resolved.Target.Address, Code.Scenery);
                    }
                    return null;
            }
            throw new InvalidOperationException("Unknown resolution");
        }
        if (verb.RequiresTarget)
        {
            return Unchanged(snapshot, command, Status.Unresolved);
        }
        return null;
    }

    // The whole transition of a command the front lets through, for the verbs ported so far. The run gate decides with the
    // front; preconditions decide next; then the root event, the verb's effects, the clock (cut at a run's limit), the run's
    // finish. A round's move is judged here as a command with the round flag, which the run gate and the clock read.
    public static Result Apply(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, VerbDecl> verbs,
        Command command)
    {
        if (Screen(snapshot, registry, verbs, command) is { } screened)
        {
            return screened;
        }
        var verb = verbs[command.Verb];
        var target = command.Target is null ? null : TargetOf(snapshot, registry, command);
        var context = new CommandContext(snapshot, registry, command, target, verb.Requires ?? []);
        if (verb.Preconditions?.Invoke(context) is { } refusal)
        {
            AssertDeclared(command.Verb, refusal);
            return Unchanged(
                snapshot,
                command,
                refusal.Status,
                // A destination that did not resolve names no target the verb could act on; an ambiguous one still
                // names the command's target (src/engine/pipeline.ts, the precondition's unresolved check).
                resolvedTarget: refusal.Status is Status.Unresolved ? null : target?.Address,
                reasonCode: refusal.ReasonCode,
                reasonData: refusal.ReasonData,
                candidates: refusal.Candidates);
        }
        // A round's move takes no time of its own: the round's close is the tick the clock moves (`docs/rounds.md`).
        var duration = command.Round == true && verb.OneTick
            ? 0L
            : (verb.Duration ?? VerbDuration.OneTick).For(command)
              ?? throw new InvalidOperationException($"Verb {command.Verb} accepted a command without a duration");
        if (!TryAdd(snapshot.Tick, duration, out _))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: Code.ClockOverflow);
        }
        // The clock never passes a running run's limit: a command that would is cut at it (`docs/run.md`).
        var left = Runs.TicksLeft(snapshot);
        var ticks = left is { } room && duration > room ? room : duration;
        var cut = ticks != duration;

        var working = new Working(snapshot, command.CommandId);
        // The root event sits on the target when there is one, else on the actor, unless the verb names its own entity and data.
        var (rootEntity, rootData) = verb.RootEvent?.Invoke(context)
            ?? (target?.EntityId ?? command.Actor, Value.Map.Empty);
        var rootEventId = working.Emit(command.Verb, rootEntity, rootData, null);
        try
        {
            verb.Transition?.Invoke(working, context, rootEventId);
            // A process whose condition the verb just made true starts, and one it made false stops.
            Processes.ReconcileSince(working, registry, 0);
            Schedule.Prune(working);
            // A command that asked to be woken says how long it ran (src/engine/pipeline.ts).
            var wake = verb.WakeOn?.Invoke(command) ?? [];
            var stop = verb.StopBefore?.Invoke(command, snapshot);
            var elapsed = Clock.Advance(working, registry, ticks, wake, stop);
            // A command that asked to be woken, to stop before a beat, or was cut at a run's limit says how long it ran.
            if (wake.Count > 0 || stop is not null || cut)
            {
                working.Events[0] = working.Events[0] with { Data = Reason(("advanced", elapsed)) };
            }
            Runs.FinishRun(working);
        }
        catch (NoSeedError)
        {
            // A roll in a world with no seed, wherever in the command it fell: the whole command is refused and nothing is kept. The code
            // belongs to the world, not to a verb, so no verb declares it.
            return Unchanged(snapshot, command, Status.Refused, resolvedTarget: target?.Address, reasonCode: Code.NoSeed);
        }
        if (verb.ValidateResult?.Invoke(context with { Snapshot = working.Snapshot }) is { } validation)
        {
            AssertDeclared(command.Verb, validation);
            return Unchanged(
                snapshot,
                command,
                validation.Status,
                resolvedTarget: target?.Address,
                reasonCode: validation.ReasonCode,
                reasonData: validation.ReasonData,
                candidates: validation.Candidates);
        }
        working.BumpVersion();
        // The batch form of perceive, asked for on the way in: every event of this command names who sensed it at either end.
        var events = command.Perceivers == true
            ? WithPerceivers(snapshot, working.Snapshot, registry, working.Events)
            : working.Events;
        return new Result(
            Status.Ok,
            command.CommandId,
            target?.Address,
            null,
            null,
            null,
            working.Snapshot,
            working.Deltas,
            events);
    }

    // Each event with who sensed it, by sense, from either end of the command (src/engine/pipeline.ts `withPerceivers`).
    private static List<WorldEvent> WithPerceivers(
        Snapshot before,
        Snapshot after,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyList<WorldEvent> events)
    {
        var described = EventPerception.EventPerceivers(before, after, registry, events)
            .ToDictionary(entry => entry.EventId, entry => entry.Perceivers, StringComparer.Ordinal);
        return [.. events.Select(@event => described.TryGetValue(@event.EventId, out var perceivers) ? @event with { Perceivers = perceivers } : @event)];
    }

    // A refusal a verb did not declare is a bug (src/engine/pipeline.ts): it throws, so a declaration that drifts from the
    // verb's refusals fails loudly. Only a refusal is judged, not an invalid command.
    private static void AssertDeclared(string verb, Refusal refusal)
    {
        if (refusal.Status != Status.Refused)
        {
            return;
        }
        if (!VerbSpecs.ByVerb.TryGetValue(verb, out var spec) || refusal.ReasonCode is null || !spec.Refuses.Contains(refusal.ReasonCode.Value))
        {
            throw new InvalidOperationException($"Verb {verb} refused with undeclared code {(refusal.ReasonCode is { } code ? WorldJson.Name(code) : "none")}");
        }
    }

    // The target a command names, once the front has accepted it: resolution cannot fail here, so only the address is
    // read out of a resolved name.
    private static Resolve.TargetAddress? TargetOf(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, Command command) =>
        Resolve.ResolveTarget(snapshot, registry, command.Actor, command.Target!) is Resolve.Resolved resolved
            ? resolved.Target
            : null;

}
