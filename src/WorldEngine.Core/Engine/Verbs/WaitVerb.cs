using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The wait verb (src/engine/verbs/wait.ts): an ordinary action whose only effect is the time it takes. The clock runs what
// falls due in the span, as it does for any verb. `until: "sensed"` ends the wait at the first tick the waiter could sense
// something, which needs event perception; it is refused loudly until that is ported.
public static class WaitVerb
{
    public static Pipeline.VerbDecl Wait { get; } = new(
        RequiresTarget: false,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: TimeVerbs.Ticks,
        WakeOn: command => Sensed(command) ? [command.Actor] : [],
        FreeArgs: true);

    // Whether the wait ends at the first tick the waiter could sense something.
    private static bool Sensed(Command command) =>
        command.Args is not null && command.Args.TryGetValue("until", out var until) && until is JsonValue json && json.TryGetValue(out string? text) && text == "sensed";

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var args = context.Command.Args;
        if (args is not null && args.TryGetValue("until", out var until))
        {
            if (until is not JsonValue json || !json.TryGetValue(out string? text) || text != "sensed")
            {
                return Pipeline.Invalid(Code.InvalidArgs);
            }
        }
        return TimeVerbs.Ticks(context.Command) is null
            ? Pipeline.Invalid(Code.InvalidArgs)
            : null;
    }
}
