namespace WorldEngine.Core.Model;

// Numbers the engine's rules share, named once. Each is a rule of the world (`docs/state.md`), not a tuning knob.
public static class Limits
{
    // An entity's integrity runs from 0 to this, unless its template declares a lower `max_integrity`.
    public const long MaxIntegrity = 100;

    // A camera whose `cone_deg` is this or more sees all the way round.
    public const double FullCircleDegrees = 360;

    // The most steps along a chain of successors (`succeeds`) a slot's live body is looked for through.
    public const int MaxSuccessionSteps = 256;
}
