using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A refusal of the world's own inputs before anything is written (src/errors.ts `WorldError`): a scenario or scene that names
// nothing it can, or a name that is taken. The code and the message are TypeScript's.
public sealed class WorldError(Code code, string message) : Exception(message)
{
    public Code Code { get; } = code;

    // The rules a snapshot broke, for `invalid_snapshot`: the answer lists each after the code (src/errors.ts `WorldError.issues`).
    public IReadOnlyList<SnapshotIssue> Issues { get; init; } = [];
}
