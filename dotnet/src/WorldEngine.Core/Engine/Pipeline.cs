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
    // What a verb declares that the front reads: whether it needs a target, and whether only the world author may
    // issue it. The full verb declaration is ported with the verbs.
    public sealed record VerbDecl(bool RequiresTarget, bool AuthorOnly);

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
}
