using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The verbs that are only time (src/engine/verbs/wait.ts). `advance` is the world author's: time with no one acting.
// Its `stop_on_perceived` and `stop_before` arguments need the pending schedule, which is not ported.
public static class TimeVerbs
{
    private const double MaxSafeInteger = 9007199254740991;

    public static Pipeline.VerbDecl Advance { get; } = new(
        RequiresTarget: false,
        AuthorOnly: true,
        Preconditions: context => AdvancePreconditions(context.Command),
        Duration: Ticks);

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

    private static Pipeline.Refusal? AdvancePreconditions(Command command)
    {
        if (command.Actor != Resolve.WorldAuthor)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_author");
        }
        if (Ticks(command) is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_args");
        }
        if (command.Args is not null && (command.Args.ContainsKey("stop_on_perceived") || command.Args.ContainsKey("stop_before")))
        {
            throw new NotPortedException("advance's stop arguments need the pending schedule");
        }
        return null;
    }
}
