using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// The version rule and the last gate of a submission (src/store/file-store.ts `resolveSubmission`), with no disk of its own. A
// command against a version the world has already left is `preempted` when it would have succeeded there, so a caller that raced
// sees why it lost. An accepted command whose result breaks a snapshot invariant is `invalid` with the rule's code, so a verb bug
// is never believed.
public static class Submission
{
    public static Pipeline.Result ResolveSubmission(
        Snapshot current,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, Pipeline.VerbDecl> verbs,
        Command command,
        long basedOn,
        Func<long, Snapshot?> snapshotAt)
    {
        if (basedOn < 0)
        {
            return InvalidResult(current, command, Code.InvalidVersion);
        }
        if (basedOn > current.Version)
        {
            return InvalidResult(current, command, Code.FutureVersion);
        }

        var result = AcceptedResult(current, registry, command, Pipeline.Apply(current, registry, verbs, command));
        if (basedOn >= current.Version || result.Status is Status.Ok or Status.Invalid)
        {
            return result;
        }

        var basedSnapshot = snapshotAt(basedOn);
        var basedResult = basedSnapshot is null
            ? null
            : AcceptedResult(basedSnapshot, registry, command, Pipeline.Apply(basedSnapshot, registry, verbs, command));
        return basedResult?.Status == Status.Ok ? result with { Status = Status.Preempted } : result;
    }

    // The result an accepted command gives, unless the snapshot it leaves breaks an invariant.
    private static Pipeline.Result AcceptedResult(
        Snapshot current,
        IReadOnlyDictionary<string, Template> registry,
        Command command,
        Pipeline.Result applied)
    {
        if (applied.Status != Status.Ok)
        {
            return applied;
        }
        var first = SnapshotValidation.Validate(applied.Snapshot, registry).FirstOrDefault();
        return first is null ? applied : InvalidResult(current, command, first.Code);
    }

    // The result of a command the world refuses to take at all: nothing changed, and the rule it broke is its reason.
    public static Pipeline.Result InvalidResult(Snapshot snapshot, Command command, Code reasonCode) =>
        Pipeline.Unchanged(snapshot, command, Status.Invalid, reasonCode: reasonCode);

    // The log's record of a submission (`attemptOf`): the command, the version it was based on and decided at, and what it said.
    // An edit as the command the reserved author sends (`editCommand`): logged and replayed like any command, with the edit as its argument.
    public static Command EditCommand(JsonObject edit, string commandId, bool perceivers = false, By? by = null) =>
        new(
            commandId,
            Resolve.WorldAuthor,
            "edit",
            Target: JsonReads.Text(edit["target"]),
            Args: new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["edit"] = edit.DeepClone() },
            Perceivers: perceivers ? true : null,
            By: by);

    public static Attempt AttemptOf(Command command, long basedOn, long version, Pipeline.Result result, RoundMark? round) =>
        new(
            command,
            basedOn,
            version,
            result.Status,
            result.ReasonCode,
            result.ReasonData is null ? null : new Dictionary<string, JsonNode?>(result.ReasonData, StringComparer.Ordinal),
            result.Candidates,
            round,
            command.By);

}
