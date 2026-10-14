using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// How long a command of a verb lasts: so many ticks, or as many as a whole positive arg names (`wait`'s `ticks`). The catalog
// writes it as declared, `{"ticks":1}` or `{"arg":"ticks"}`.
public sealed record VerbDuration(
    long? Ticks = null,
    string? Arg = null)
{
    public static readonly VerbDuration OneTick = new(Ticks: 1);

    public static VerbDuration Fixed(long ticks) => new(Ticks: ticks);

    public static VerbDuration FromArg(string arg) => new(Arg: arg);

    // Null when the arg is missing or not a whole number above zero; the verb refuses such a command before it is timed.
    public long? For(Command command) => Ticks ?? ArgTicks(command, Arg!);

    public static long? ArgTicks(Command command, string arg) =>
        command.Args?.GetValueOrDefault(arg).AsInt() is > 0 and var ticks ? ticks : null;
}
