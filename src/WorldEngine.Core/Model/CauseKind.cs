namespace WorldEngine.Core.Model;

// The kinds of cause the schedule runs, as a stored cause names its own. A kind with no record here does not read.
public static class CauseKind
{
    public const string Beat = "beat";
    public const string Bleed = "bleed";
    public const string Close = "close";
    public const string Outcome = "outcome";
    public const string Process = "process";
}
