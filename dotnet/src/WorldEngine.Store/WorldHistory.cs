using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// The reads over a world's history (src/store/file-store.ts `since` and `attempts`): what every accepted command after a version did,
// and every submission decided at or after it, ok or not. Both read the log and the current version, and neither writes. Replays start
// from initial.json; the TypeScript store starts from its newest checkpoint instead, which gives the same answer, only sooner, and
// checkpoints come with the write path.
public static class WorldHistory
{
    // The deltas and events of every accepted command decided at `version` or later, in command order.
    public static (List<Delta> Deltas, List<WorldEvent> Events) Since(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        CheckVersion(dir, version, registry);

        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        var deltas = new List<Delta>();
        var events = new List<WorldEvent>();
        var entries = WorldFiles.ReadLog(dir);
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            if (result.Status != Status.Ok)
            {
                throw new WorldError("replay_diverges", $"Accepted command failed during replay at line {index + 1}");
            }
            // Collected by the version the command was applied to, as the TypeScript store does.
            if (snapshot.Version >= version)
            {
                deltas.AddRange(result.Deltas);
                events.AddRange(result.Events);
            }
            snapshot = result.Snapshot;
        }
        return (deltas, events);
    }

    // Every submission decided at `version` or later, in the order it came, ok or not, read straight from the log.
    public static List<Attempt> Attempts(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        CheckVersion(dir, version, registry);
        return WorldFiles.ReadLog(dir).Where(entry => entry.Version >= version).ToList();
    }

    // The version must be a safe, non-negative integer and no later than the world's current one.
    private static void CheckVersion(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        if (version < 0 || version > MaxSafeInteger)
        {
            throw new WorldError("invalid_version", $"Invalid version {version}");
        }
        var current = WorldReplay.TrustedSnapshot(dir, registry)
            ?? throw new WorldError("store_unsettled", "The world's files disagree with its head; settling them is not ported yet");
        if (version > current.Version)
        {
            throw new WorldError("future_version", $"Version {version} is ahead of {current.Version}");
        }
    }

    private const long MaxSafeInteger = 9007199254740991;
}
