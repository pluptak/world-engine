using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// An edit to a stored world (src/api.ts `edit`, `entryCount`): the edit as the reserved author's command, submitted like any command. Its
// id is `edit-<n>` with n one more than the logged submissions, so the same sequence of calls writes the same log through any handle. The
// count and the submission are one turn, or two processes editing at once would both name the same next edit.
public static class WorldEdits
{
    public static Pipeline.Result Edit(
        string dir,
        IReadOnlyDictionary<string, Template> registry,
        Value.Map edit,
        string? commandId = null,
        bool perceivers = false,
        By? by = null,
        long? basedOn = null,
        int snapshotEvery = WorldWriter.SnapshotEvery,
        int checkpointEvery = WorldWriter.CheckpointEvery)
    {
        if (!WorldFiles.Exists(dir))
        {
            throw new WorldError(Code.NoSuchWorld, $"No world at {dir}");
        }
        return WorldLock.With(dir, () =>
        {
            var id = commandId ?? $"edit-{WorldFiles.ReadLog(dir).Count + 1}";
            return WorldWriter.Submit(dir, registry, Submission.EditCommand(edit, id, perceivers, by), basedOn, snapshotEvery: snapshotEvery, checkpointEvery: checkpointEvery);
        });
    }
}
