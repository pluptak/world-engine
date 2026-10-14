using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// Changing a world's template set (src/store/file-store.ts `writeWorldTemplates`, `replayToVersion`, `firstLostField`, `settle`'s takeover,
// and api.ts `upgradeTemplates`). The lost-field rule itself is `Upgrade` in the engine; this is what the store does around it. An upgrade
// proves the set first, by the log replaying under it to what the world holds, and only then stamps the set's hash on the files, head last.
// A crash between those stamps leaves a head that names the old set; a world whose own templates.json names the new one takes itself over
// the same way, after the same proof.
public static class WorldUpgrade
{
    // Moves the world to `target`: refused when a live entity would lose a field, or the log does not replay under `target` to the world
    // as it stands. Returns the snapshot at the new set (`upgradeTemplates`).
    public static Snapshot UpgradeTemplates(string dir, IReadOnlyDictionary<string, Template> target, IReadOnlyDictionary<string, Template> active)
    {
        var missing = TemplateResolver.MissingCompanions(target);
        if (missing.Count > 0)
        {
            throw new WorldError(Code.InvalidTemplates, $"Missing detached part template {missing[0]}");
        }
        return WorldLock.With(dir, () =>
        {
            var current = WorldSettle.Load(dir, active);
            Upgrade.AssertNoLost(current, target);
            // The log was produced under the old set, so a set that folds it to anything else would leave a world whose history no longer
            // reproduces its own snapshot.
            var replayed = WorldReplay.ReplayFold(dir, target);
            if (WorldWriter.Canonical(replayed.Snapshot) != WorldWriter.Canonical(current)
                || WorldWriter.Canonical(replayed.Events) != WorldWriter.Canonical(WorldFiles.ReadEvents(dir))
                || WorldWriter.Canonical(replayed.Deltas) != WorldWriter.Canonical(WorldFiles.ReadDeltas(dir)))
            {
                throw new WorldError(Code.ReplayDiverges, $"History replays to version {replayed.Snapshot.Version}, not {current.Version}");
            }
            WriteTemplates(dir, target);
            return WorldSettle.Load(dir, target);
        });
    }

    // A head that names another set, after a crash between the stamps: the set is the world's own, so the world is taken over under the
    // turn, once the log is proved to replay under it to the stored snapshot and to the stored events and deltas. Otherwise refused.
    internal static Snapshot Takeover(
        string dir,
        IReadOnlyDictionary<string, Template> registry,
        Snapshot snapshot,
        Snapshot initial,
        WorldFiles.HeadFile head)
    {
        var frozen = WorldReplay.HashOf(registry);
        Upgrade.AssertNoLost(snapshot, registry);
        WorldReplay.Fold folded;
        try
        {
            folded = WorldReplay.ReplayFold(dir, registry);
        }
        catch (Exception)
        {
            // The set cannot replay a command the log accepted: the lost field is the one the log names, else the set is a changed one.
            if (FirstLostField(dir, registry) is { } lost)
            {
                throw Upgrade.LostError(lost);
            }
            throw new WorldError(Code.TemplatesChanged, "Template hash mismatch");
        }
        // The stored snapshot is judged at its own version, since it may lag the log: it must be the replay there.
        var atStored = ReplayToVersion(dir, snapshot.Version, registry);
        var deltasPath = Path.Combine(dir, WorldFiles.Deltas);
        if (atStored is null
            || WorldWriter.Canonical(atStored with { TemplatesHash = frozen }) != WorldWriter.Canonical(snapshot with { TemplatesHash = frozen })
            || WorldWriter.Canonical(folded.Events) != WorldWriter.Canonical(WorldFiles.ReadEvents(dir))
            || (head.DeltasBytes is not null && File.Exists(deltasPath)
                && WorldWriter.Canonical(folded.Deltas) != WorldWriter.Canonical(WorldFiles.ReadDeltas(dir))))
        {
            throw new WorldError(Code.TemplatesChanged, "Template hash mismatch");
        }
        WorldCheckpoints.Drop(dir);
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.InitialSnapshot), WorldWriter.Canonical(initial with { TemplatesHash = frozen }));
        WorldWriter.AtomicWrite(
            Path.Combine(dir, WorldFiles.CurrentSnapshot),
            WorldWriter.Canonical(folded.Snapshot with { TemplatesHash = frozen }));
        // The set moved, so the snapshot is written at the current version under the new hash.
        WorldWriter.AtomicWrite(
            Path.Combine(dir, WorldFiles.Head),
            WorldWriter.Canonical(HeadObject(head, frozen, folded.Snapshot.Version, new FileInfo(Path.Combine(dir, WorldFiles.Log)).Length)));
        return WorldSettle.Load(dir, registry);
    }

    // The set written as the world's own: templates.json, the hash on initial.json, snapshot.json and head.json (`writeWorldTemplates`).
    private static void WriteTemplates(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        var hash = WorldReplay.HashOf(registry);
        var initialPath = Path.Combine(dir, WorldFiles.InitialSnapshot);
        var currentPath = Path.Combine(dir, WorldFiles.CurrentSnapshot);
        var initial = WorldFiles.ReadSnapshot(initialPath);
        var snapshot = WorldFiles.ReadSnapshot(currentPath);
        WorldCheckpoints.Drop(dir);
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Templates), WorldWriter.Canonical(registry));
        WorldWriter.AtomicWrite(initialPath, WorldWriter.Canonical(initial with { TemplatesHash = hash }));
        WorldWriter.AtomicWrite(currentPath, WorldWriter.Canonical(snapshot with { TemplatesHash = hash }));
        var head = WorldFiles.ReadHead(dir);
        var stamped = head is null
            ? new JsonObject
            {
                ["log_bytes"] = 0,
                ["events_bytes"] = 0,
                ["log_entries"] = 0,
                ["ok_entries"] = 0,
                ["templates_hash"] = hash,
            }
            : HeadObject(head, hash, head.SnapshotVersion, head.SnapshotLogBytes);
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Head), WorldWriter.Canonical(stamped));
    }

    // head.json with its fields, the hash and the snapshot it names (the spread in `settle` and `writeWorldTemplates`).
    private static JsonObject HeadObject(WorldFiles.HeadFile head, string hash, long? snapshotVersion, long? snapshotLogBytes)
    {
        var value = new JsonObject
        {
            ["log_bytes"] = head.LogBytes,
            ["events_bytes"] = head.EventsBytes,
            ["log_entries"] = head.LogEntries,
            ["ok_entries"] = head.OkEntries,
            ["templates_hash"] = hash,
        };
        if (head.DeltasBytes is { } deltas)
        {
            value["deltas_bytes"] = deltas;
        }
        if (head.RoundsClosed is { } rounds)
        {
            value["rounds_closed"] = rounds;
        }
        if (snapshotVersion is { } version)
        {
            value["snapshot_version"] = version;
        }
        if (snapshotLogBytes is { } bytes)
        {
            value["snapshot_log_bytes"] = bytes;
        }
        return value;
    }

    // The snapshot at `version` as the log replays under `registry`, from initial.json; null when the replay fails or does not reach it.
    private static Snapshot? ReplayToVersion(string dir, long version, IReadOnlyDictionary<string, Template> registry)
    {
        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        try
        {
            foreach (var entry in WorldFiles.ReadLog(dir))
            {
                if (snapshot.Version >= version)
                {
                    break;
                }
                if (entry.Status != Status.Ok)
                {
                    continue;
                }
                var result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
                if (result.Status != Status.Ok)
                {
                    return null;
                }
                snapshot = result.Snapshot;
            }
        }
        catch (Exception)
        {
            return null;
        }
        return snapshot.Version == version ? snapshot : null;
    }

    // The lost field the set makes of the first accepted command it cannot replay: the state's own lost field, else a set_part of a part the
    // set no longer declares for its entity. Null when the failure is something else (`firstLostField`).
    private static Upgrade.LostField? FirstLostField(string dir, IReadOnlyDictionary<string, Template> registry)
    {
        var snapshot = WorldFiles.ReadSnapshot(Path.Combine(dir, WorldFiles.InitialSnapshot));
        foreach (var entry in WorldFiles.ReadLog(dir))
        {
            if (entry.Status != Status.Ok)
            {
                continue;
            }
            Pipeline.Result? result;
            try
            {
                result = Pipeline.Apply(snapshot, registry, VerbRegistry.All, entry.Command);
            }
            catch (Exception)
            {
                result = null;
            }
            if (result is { Status: Status.Ok })
            {
                snapshot = result.Snapshot;
                continue;
            }
            if (Upgrade.Lost(snapshot, registry) is { } before)
            {
                return before;
            }
            if (entry.Command.Verb != "edit"
                || entry.Command.Args?.GetValueOrDefault("edit") is not Value.Map edit
                || edit.GetValueOrDefault("kind").AsText() != "set_part"
                || edit.GetValueOrDefault("target").AsText() is not { } target
                || edit.GetValueOrDefault("part").AsText() is not { } part)
            {
                return null;
            }
            if (!snapshot.Entities.TryGetValue(target, out var entity)
                || !registry.TryGetValue(entity.Template, out var template)
                || template.Parts.Any(declared => declared.Name == part))
            {
                return null;
            }
            return new Upgrade.LostField(entity.Id, entity.Template, $"parts.{part}");
        }
        return null;
    }
}
