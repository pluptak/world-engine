namespace WorldEngine.Core.Engine;

// The kinds of cause the schedule runs. A stored snapshot may name another, which validation reports as `unknown_cause_kind`.
public static class CauseKind
{
    public const string Beat = "beat";
    public const string Bleed = "bleed";
    public const string Close = "close";
    public const string Process = "process";
}
