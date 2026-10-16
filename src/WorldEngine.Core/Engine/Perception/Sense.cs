namespace WorldEngine.Core.Engine;

// The senses the engine has rules for. A request or a world's coverage may name another; asked about, it answers
// `unknown` with `engine_incapable`, so a sense stays a string rather than an enum.
public static class Sense
{
    public const string Sight = "sight";
    public const string Hearing = "hearing";
    public const string Smell = "smell";
    public const string Touch = "touch";

    public static readonly IReadOnlyList<string> All = [Sight, Hearing, Smell, Touch];
}
