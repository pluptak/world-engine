using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The verbs that are only time (src/engine/verbs/wait.ts). `advance` is the world author's: time with no one acting. Its
// `stop_on_perceived` agents end the time early at the first tick one of them could sense something. Its `stop_before`
// argument needs the pending beats, which are not ported.
public static class TimeVerbs
{
    private const double MaxSafeInteger = 9007199254740991;

    public static Pipeline.VerbDecl Advance { get; } = new(
        RequiresTarget: false,
        AuthorOnly: true,
        Preconditions: AdvancePreconditions,
        Duration: Ticks,
        WakeOn: command => Listed(command) ?? []);

    // The `ticks` arg as a positive safe integer, or null when it is not one (src/engine/clock.ts `commandDuration`).
    public static long? Ticks(Command command)
    {
        if (command.Args is null
            || !command.Args.TryGetValue("ticks", out var node)
            || node is null
            || node.GetValueKind() != JsonValueKind.Number)
        {
            return null;
        }
        var value = node.GetValue<double>();
        if (value != Math.Floor(value) || value <= 0 || value > MaxSafeInteger)
        {
            return null;
        }
        return (long)value;
    }

    // The agents `stop_on_perceived` names: none when the argument is absent, else a non-empty list of ids, or null when
    // the argument is malformed.
    private static IReadOnlyList<string>? Listed(Command command)
    {
        if (command.Args is null || !command.Args.TryGetValue("stop_on_perceived", out var node))
        {
            return [];
        }
        if (node is not JsonArray array || array.Count == 0)
        {
            return null;
        }
        var ids = new List<string>(array.Count);
        foreach (var element in array)
        {
            if (element is not JsonValue value || !value.TryGetValue(out string? id) || id.Length == 0)
            {
                return null;
            }
            ids.Add(id);
        }
        return ids;
    }

    private static Pipeline.Refusal? AdvancePreconditions(Pipeline.CommandContext context)
    {
        var command = context.Command;
        if (command.Actor != Resolve.WorldAuthor)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_author");
        }
        if (Ticks(command) is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_args");
        }
        if (Listed(command) is not { } ids)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_args");
        }
        foreach (var id in ids)
        {
            // A body destroyed is still there, but no longer an agent: the code says which.
            if (!context.Snapshot.Entities.TryGetValue(id, out var watcher) || !Reach.IsAgent(context.Snapshot, id))
            {
                return new Pipeline.Refusal(
                    Status.Invalid,
                    watcher?.Status == EntityStatus.Destroyed ? "observer_destroyed" : "no_such_actor");
            }
        }
        if (command.Args is not null && command.Args.ContainsKey("stop_before"))
        {
            throw new NotPortedException("advance's stop_before needs beats");
        }
        return null;
    }
}
