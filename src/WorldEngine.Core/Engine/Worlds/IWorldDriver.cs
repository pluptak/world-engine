using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The operations a world answers whatever keeps it: the memory world and a stored world (src/api.ts `World`, for the calls both
// implementations make). A caller that holds one can change nothing about which it is, and gets the same answers from either.
public interface IWorldDriver
{
    Snapshot CurrentSnapshot();

    // A command, decided against the world and logged whatever it said; `basedOn` is the version it was sent against.
    Pipeline.Result Apply(Command command, long? basedOn = null);

    // An author edit, with `edit-<n>` as its id unless one is given.
    Pipeline.Result Edit(Value.Map edit, string? commandId = null, bool perceivers = false, By? by = null, long? basedOn = null);

    // The deltas and events of every accepted command decided at `version` or later.
    (List<Delta> Deltas, List<WorldEvent> Events) Since(long version);

    // Every submission decided at `version` or later, ok or not.
    IReadOnlyList<Attempt> Attempts(long version);
}
