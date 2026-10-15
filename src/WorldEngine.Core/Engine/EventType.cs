namespace WorldEngine.Core.Engine;

// The events the engine emits as a command's consequences. A command's own root event is named for its verb (`take`, `say`), and a
// verb is a registry entry, so a type stays a string; `EventPerception` says how each is sensed.
public static class EventType
{
    public const string BeatSkipped = "beat_skipped";
    public const string Broken = "broken";
    public const string CapabilityChanged = "capability_changed";
    public const string Changed = "changed";
    public const string Closed = "closed";
    public const string Closing = "closing";
    public const string Collided = "collided";
    public const string Consumed = "consumed";
    public const string Damaged = "damaged";
    public const string Destroyed = "destroyed";
    public const string Cut = "cut";
    public const string Detached = "detached";
    public const string Displaced = "displaced";
    public const string Doused = "doused";
    public const string Dropped = "dropped";
    public const string Edited = "edited";
    public const string Extracted = "extracted";
    public const string Found = "found";
    public const string Installed = "installed";
    public const string Jammed = "jammed";
    public const string Lit = "lit";
    public const string Locked = "locked";
    public const string Moved = "moved";
    public const string Opened = "opened";
    public const string OutcomeFailed = "outcome_failed";
    public const string OutcomeScheduled = "outcome_scheduled";
    public const string OutcomeSucceeded = "outcome_succeeded";
    public const string Placed = "placed";
    public const string Poured = "poured";
    public const string Removed = "removed";
    public const string Revealed = "revealed";
    public const string Sounded = "sounded";
    public const string Spawned = "spawned";
    public const string Spent = "spent";
    public const string Spilled = "spilled";
    public const string Switched = "switched";
    public const string Unlocked = "unlocked";
}
