using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The front of a command's transition (src/engine/pipeline.ts `apply`, up to the verb's preconditions): what the
// command names and whether its actor can act at all. A command that fails here never reaches a verb, so its result
// is decided by the world alone. The rest of `apply` (preconditions, the root event, the transition, the clock) is
// not ported yet, and `Screen` returns null for a command that would go on to them.
public static class Pipeline
{
    // What a verb declares: whether it needs a target, whether only the world author may issue it, its preconditions
    // (null when it has none beyond the front), its duration in ticks (null when it takes none), the capacities its
    // actor must hold (`requires`), and its transition, run after the root event (null when it changes nothing). The
    // verbs are ported one at a time; a verb without a declaration here is not yet in the table.
    public sealed record VerbDecl(
        bool RequiresTarget,
        bool AuthorOnly,
        Func<CommandContext, Refusal?>? Preconditions = null,
        Func<Command, long?>? Duration = null,
        IReadOnlyList<Requirement>? Requires = null,
        Action<Working, CommandContext, string>? Transition = null,
        Func<CommandContext, (string Entity, IReadOnlyDictionary<string, JsonNode?> Data)>? RootEvent = null,
        Func<Command, IReadOnlyList<string>>? WakeOn = null,
        // Judges the snapshot the transition and the clock left (src/engine/pipeline.ts `validateResult`): a refusal
        // returns the input snapshot unchanged. Null when the verb has no such check.
        Func<CommandContext, Refusal?>? ValidateResult = null,
        // Where the time a command passes stops short: the beat `stop_before` names, as pending when the command is decided
        // (src/engine/command.ts `stop_before`). Null when the verb has none.
        Func<Command, Snapshot, Clock.StopBeat?>? StopBefore = null);

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
        string? ReasonCode,
        IReadOnlyDictionary<string, JsonNode?>? ReasonData = null,
        IReadOnlyList<string>? Candidates = null);

    // The reason data of a refusal or event: named values, each a string, a number or a boolean.
    public static IReadOnlyDictionary<string, JsonNode?> Reason(params (string Key, object Value)[] pairs) =>
        pairs.ToDictionary(pair => pair.Key, pair => (JsonNode?)JsonValue.Create(pair.Value), StringComparer.Ordinal);

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
        var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
        {
            ["capacity"] = JsonValue.Create(unmet.Capacity),
            ["have"] = JsonValue.Create(Have(caps, unmet.Capacity)),
            ["need"] = JsonValue.Create(unmet.AtLeast),
        };
        return new Refusal(Status.Refused, $"insufficient_{context.Requires[0].Capacity}", data);
    }

    public sealed record Result(
        Status Status,
        string CommandId,
        string? ResolvedTarget,
        IReadOnlyList<string>? Candidates,
        string? ReasonCode,
        IReadOnlyDictionary<string, JsonNode?>? ReasonData,
        Snapshot Snapshot,
        IReadOnlyList<Delta> Deltas,
        IReadOnlyList<WorldEvent> Events);

    // The result of a command the front refuses, which leaves the snapshot as it was.
    public static Result Unchanged(
        Snapshot snapshot,
        Command command,
        Status status,
        string? resolvedTarget = null,
        string? reasonCode = null,
        IReadOnlyList<string>? candidates = null,
        IReadOnlyDictionary<string, JsonNode?>? reasonData = null) =>
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
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: "unknown_verb");
        }

        var authored = command.Actor == Resolve.WorldAuthor && verb.AuthorOnly;
        if (!authored && !snapshot.Entities.ContainsKey(command.Actor))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: "no_such_actor");
        }
        if (!authored && !Reach.IsAgent(snapshot, command.Actor))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: "not_an_agent");
        }

        // An agent a controller runs acts only while its control walk carries the command, and one with a
        // `powered_by` only while it has power.
        if (!authored && Power.AgentFault(snapshot, command.Actor) is { } fault)
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: fault.ReasonCode, reasonData: fault.ReasonData);
        }
        // A sleeping body makes no command of its own; the world author may still act on it.
        var actor = snapshot.Entities.GetValueOrDefault(command.Actor);
        if (!authored && actor is not null && PropValues.IsTrue(actor.Props, "asleep"))
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: "asleep");
        }
        if (!authored && actor is not null && PropValues.IsTrue(actor.Props, "unconscious"))
        {
            return Unchanged(snapshot, command, Status.Refused, reasonCode: "unconscious");
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
                        return Unchanged(snapshot, command, Status.Refused, resolved.Target.Address, "scenery");
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

    // The whole transition of a command the front lets through, for the verbs ported so far. Preconditions decide
    // first; then the root event, the verb's effects (none yet for `advance`), and the clock. Scheduled causes, runs,
    // processes and per-event perceivers are not ported, so a command that needs them is refused loudly.
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
        if (command.Perceivers == true)
        {
            throw new NotPortedException("per-event perceivers");
        }
        if (command.Round == true)
        {
            throw new NotPortedException("rounds");
        }
        var verb = verbs[command.Verb];
        var target = command.Target is null ? null : TargetOf(snapshot, registry, command);
        var context = new CommandContext(snapshot, registry, command, target, verb.Requires ?? []);
        if (verb.Preconditions?.Invoke(context) is { } refusal)
        {
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
        var duration = verb.Duration?.Invoke(command)
            ?? throw new InvalidOperationException($"Verb {command.Verb} accepted a command without a duration");
        if (!IsSafeInteger(snapshot.Tick + duration))
        {
            return Unchanged(snapshot, command, Status.Invalid, reasonCode: "clock_overflow");
        }

        var working = new Working(snapshot, command.CommandId);
        // The root event sits on the target when there is one, else on the actor, unless the verb names its own entity and data.
        var (rootEntity, rootData) = verb.RootEvent?.Invoke(context)
            ?? (target?.EntityId ?? command.Actor, new Dictionary<string, JsonNode?>());
        var rootEventId = working.Emit(command.Verb, rootEntity, rootData, null);
        verb.Transition?.Invoke(working, context, rootEventId);
        // A process whose condition the verb just made true starts, and one it made false stops.
        Processes.ReconcileSince(working, registry, 0);
        Schedule.Prune(working);
        // A command that asked to be woken says how long it ran (src/engine/pipeline.ts).
        var wake = verb.WakeOn?.Invoke(command) ?? [];
        var stop = verb.StopBefore?.Invoke(command, snapshot);
        var elapsed = Clock.Advance(working, registry, duration, wake, stop);
        if (wake.Count > 0 || stop is not null)
        {
            working.Events[0] = working.Events[0] with { Data = Reason(("advanced", elapsed)) };
        }
        if (verb.ValidateResult?.Invoke(context with { Snapshot = working.Snapshot }) is { } validation)
        {
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
        return new Result(
            Status.Ok,
            command.CommandId,
            target?.Address,
            null,
            null,
            null,
            working.Snapshot,
            working.Deltas,
            working.Events);
    }

    // The target a command names, once the front has accepted it: resolution cannot fail here, so only the address is
    // read out of a resolved name.
    private static Resolve.TargetAddress? TargetOf(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, Command command) =>
        Resolve.ResolveTarget(snapshot, registry, command.Actor, command.Target!) is Resolve.Resolved resolved
            ? resolved.Target
            : null;

    private const long MaxSafeInteger = 9007199254740991;

    private static bool IsSafeInteger(long value) => Math.Abs(value) <= MaxSafeInteger;
}
