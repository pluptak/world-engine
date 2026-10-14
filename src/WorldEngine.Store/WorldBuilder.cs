using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Store;

// Making a world (src/api.ts `createWorld` and `restartWorld`, src/store/file-store.ts `create`): a scenario spawned into a snapshot,
// entry by entry, with the architect's checks and forms on each, then the processes started, the scene's beats and run set, and the
// snapshot checked. Nothing is written for a refused scenario; the files of a made world are written only after all of that.
public static class WorldBuilder
{
    // The coverage a world declares when its scenario names none (src/model.ts `defaultCoverage`). The order is TypeScript's.
    public static readonly Coverage DefaultCoverage = new(
        ["support", "contained_in", "attached_to", "status", "location", "near", "reachable"],
        [Sense.Sight, Sense.Hearing],
        ["integrity", "residue", "pos", Prop.Open]);

    // The snapshot a scenario makes, and the ids its names gave. A scenario is a list of entries, or a scene with `entities`, `seed`,
    // `beats` and `run`; a list alone is a scene with none of the rest.
    public sealed record Made(Snapshot Snapshot, IReadOnlyDictionary<string, string> Ids);

    public static Made Snapshot(JsonNode scenario, IReadOnlyDictionary<string, Template> registry, Coverage? coverage = null)
    {
        var scene = scenario as JsonObject;
        var entries = scene is null ? (JsonArray)scenario : (JsonArray)scene["entities"]!;
        var initial = new Snapshot(
            Version: 0,
            Tick: 0,
            NextSeq: 1,
            TemplatesHash: WorldReplay.HashOf(registry),
            Coverage: coverage ?? DefaultCoverage,
            Entities: new Dictionary<string, Entity>(StringComparer.Ordinal),
            Rng: JsonReads.SafeInt(scene?["seed"]));

        var resolved = ScenarioResolver.Resolve(entries, initial.NextSeq);
        var snapshot = initial;
        for (var index = 0; index < resolved.Scenario.Count; index++)
        {
            var entry = resolved.Scenario[index]!.AsObject();
            var template = entry["template"]!.GetValue<string>();
            var written = entry["overrides"] as JsonObject ?? new JsonObject();
            if (DerivedFieldWritten(snapshot, written) is { } derived)
            {
                throw new WorldError(Code.DerivedField, $"Scenario entry {index} writes the derived field {derived}");
            }
            if (Forms.ArchitectWrites(written) is { } unwritable)
            {
                throw new WorldError(Code.FieldNotEditable, $"Scenario entry {index} writes {unwritable}, which the architect may not");
            }
            // A form is converted to the one stored value before any rule reads the entry; an unknown template is left to spawn's refusal.
            var overrides = registry.TryGetValue(template, out var known) && Forms.HasForms(written)
                ? Forms.Apply(known, written, index)
                : written;
            var parsed = EditVerb.ParseOverrides(template, overrides)
                ?? throw new WorldError(Code.InvalidScenario, $"Scenario entry {index} does not describe an entity");
            // A scenario's spawn keeps the location as written, and an omitted one is none: the chain is not derived here (a location the
            // chain gives must be written, and the snapshot check refuses one that is not, as spawn in src/engine/spawn.ts does).
            var location = parsed.Location?.Value;
            snapshot = Spawn.Create(snapshot, registry, template, parsed.Fields with { Location = location }).Snapshot;
        }

        snapshot = Processes.StartProcesses(snapshot, registry);
        snapshot = SceneBuilder.Build(snapshot, registry, resolved.Ids, scene?["beats"] as JsonArray, scene?["run"] as JsonObject);
        var issues = SnapshotValidation.Validate(snapshot, registry);
        if (issues.Count > 0)
        {
            throw new WorldError(Code.InvalidSnapshot, $"Snapshot violates {WorldJson.Name(issues[0].Code)} ({issues.Count} issue(s))") { Issues = issues };
        }
        return new Made(snapshot, resolved.Ids);
    }

    // Writes a new world's files: the format marker, the set, the initial and current snapshots, the ids when a scenario named any, empty
    // logs, and the head (`create`). A directory holding any of them is not refused here; `restart` refuses it.
    public static void Create(string dir, Snapshot initial, IReadOnlyDictionary<string, Template> registry, IReadOnlyDictionary<string, string> ids)
    {
        Directory.CreateDirectory(dir);
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Format), WorldWriter.Canonical(new JsonObject { ["schema_version"] = WorldFiles.SchemaVersion }));
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Templates), WorldWriter.Canonical(registry));
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.InitialSnapshot), WorldWriter.Canonical(initial));
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.CurrentSnapshot), WorldWriter.Canonical(initial));
        if (ids.Count > 0)
        {
            WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Ids), WorldWriter.Canonical(ids));
        }
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Log), string.Empty);
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Events), string.Empty);
        WorldWriter.AtomicWrite(Path.Combine(dir, WorldFiles.Deltas), string.Empty);
        WorldWriter.AtomicWrite(
            Path.Combine(dir, WorldFiles.Head),
            WorldWriter.Canonical(new JsonObject
            {
                ["log_bytes"] = 0,
                ["events_bytes"] = 0,
                ["deltas_bytes"] = 0,
                ["log_entries"] = 0,
                ["ok_entries"] = 0,
                ["rounds_closed"] = 0,
                ["snapshot_version"] = initial.Version,
                ["snapshot_log_bytes"] = 0,
                ["templates_hash"] = WorldReplay.HashOf(registry),
            }));
    }

    // A world made again from another's initial snapshot, its set and its names, at a directory no world holds (`restartWorld`).
    public static void Restart(string from, string to)
    {
        if (!WorldFiles.Exists(from))
        {
            throw new WorldError(Code.NoSuchWorld, $"No world at {from}");
        }
        var initial = WorldFiles.ReadSnapshot(Path.Combine(from, WorldFiles.InitialSnapshot));
        var templates = WorldFiles.ReadTemplates(from);
        if (WorldFiles.HoldsAny(to))
        {
            throw new WorldError(Code.WorldExists, $"A world is already at {to}");
        }
        Create(to, initial, templates, WorldFiles.ReadIds(from));
    }

    // The first thing a scenario entry writes that the engine would derive instead (`derivedFieldWritten`): a location the chain does not
    // give, or a modifier, since every modifier is caused by an event. Null when neither.
    private static string? DerivedFieldWritten(Snapshot snapshot, JsonObject overrides)
    {
        if (overrides.ContainsKey("location")
            && Placements.DerivedLocationOf(snapshot, JsonReads.Text(overrides["support"]), JsonReads.Text(overrides["contained_in"]), out var derived)
            && derived != JsonReads.Text(overrides["location"]))
        {
            return "location";
        }
        return overrides["modifiers"] is JsonArray { Count: > 0 } ? "modifiers" : null;
    }
}
