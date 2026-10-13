using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

namespace WorldEngine.Core.Engine;

// A rule a snapshot breaks: its code, the path to the field, and a detail (src/engine/validate.ts `SnapshotIssue`).
public sealed record SnapshotIssue(string Code, IReadOnlyList<string> Path, string Message);

// The snapshot invariants (src/engine/validate.ts `validateSnapshot`), for the rules the .NET engine has ported.
// Issues come in TypeScript's order, so the first one is the same code either side.
public static class SnapshotValidation
{
    private const int MaxTraits = 16;
    private static readonly Regex TraitKey = new(@"^[a-z][a-z0-9_]{0,31}$", RegexOptions.CultureInvariant);

    // The relations and senses the engine computes (src/engine/capabilities.ts `ENGINE_CAPABILITIES`).
    private static readonly HashSet<string> ComputedRelations =
        ["support", "contained_in", "location", "attached_to", "status", "near", "reachable"];
    private static readonly HashSet<string> ComputedSenses = ["sight", "hearing", "smell", "touch"];

    public static IReadOnlyList<SnapshotIssue> Validate(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry)
    {
        var issues = new List<SnapshotIssue>();
        var spawned = DetachedIndex(snapshot);
        // One issue per loop, however many entities sit in it.
        var reportedLoops = new HashSet<string>(StringComparer.Ordinal);
        var reportedConcealLoops = new HashSet<string>(StringComparer.Ordinal);
        var reportedPowerLoops = new HashSet<string>(StringComparer.Ordinal);
        var reportedControlLoops = new HashSet<string>(StringComparer.Ordinal);

        // Coverage chooses among what the engine computes; a name it has no rule for is refused rather than answered.
        foreach (var name in snapshot.Coverage.Relations.Order(StringComparer.Ordinal).Where(name => !ComputedRelations.Contains(name)))
        {
            issues.Add(Issue("coverage_not_computable", ["coverage", "relations", name], name));
        }
        foreach (var name in snapshot.Coverage.Senses.Order(StringComparer.Ordinal).Where(name => !ComputedSenses.Contains(name)))
        {
            issues.Add(Issue("coverage_not_computable", ["coverage", "senses", name], name));
        }

        foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            var entity = snapshot.Entities[id];
            var path = new[] { "entities", id };

            var numeric = Regex.Match(id, @"^e(\d+)$");
            if (numeric.Success && double.Parse(numeric.Groups[1].Value, CultureInfo.InvariantCulture) >= snapshot.NextSeq)
            {
                issues.Add(Issue("id_not_below_next_seq", path, $"next_seq {snapshot.NextSeq}"));
            }
            if (!registry.ContainsKey(entity.Template))
            {
                issues.Add(Issue("unknown_template", [.. path, "template"], entity.Template));
            }
            issues.AddRange(IntegrityIssues(snapshot, registry, id, path));
            issues.AddRange(CameraIssues(snapshot, id, path));
            issues.AddRange(ReferenceIssues(snapshot, id, path));
            issues.AddRange(ContainerFitIssues(snapshot, registry, id, path));
            issues.AddRange(TraitIssues(entity, path));
            issues.AddRange(ConcealmentIssues(snapshot, registry, reportedConcealLoops, id, path));
            issues.AddRange(HolderIssues(snapshot, registry, id, path));
            issues.AddRange(PropIssues(registry, entity, path));
            issues.AddRange(LoopIssues(LinkLoop(snapshot, id, entity => Str(entity.Props, "powered_by")), id, reportedPowerLoops, path, "power_loop"));
            issues.AddRange(LoopIssues(LinkLoop(snapshot, id, entity => Str(entity.Props, "controlled_by")), id, reportedControlLoops, path, "control_loop"));

            // A room is where things are, never a thing somewhere: nothing holds, supports or hides it.
            if (entity.Template == TemplateIds.Room && (entity.Support is not null || entity.ContainedIn is not null || entity.ConcealedBy is not null))
            {
                issues.Add(Issue("room_placed", path, $"support {entity.Support} contained_in {entity.ContainedIn}"));
            }

            // One entity sits in one place: on something or inside something, never both.
            if (entity.Support is not null && entity.ContainedIn is not null)
            {
                issues.Add(Issue("support_and_contained_in", path, $"support {entity.Support} contained_in {entity.ContainedIn}"));
            }

            // A missing link already has its issue; the rules below read chains, so they stay out of the way.
            var chainDangles =
                (entity.Support is not null && !snapshot.Entities.ContainsKey(entity.Support))
                || (entity.ContainedIn is not null && !snapshot.Entities.ContainsKey(entity.ContainedIn));
            if (!chainDangles)
            {
                issues.AddRange(LoopIssues(
                    LinkLoop(snapshot, id, next => next.ContainedIn ?? next.Support),
                    id,
                    reportedLoops,
                    path,
                    "support_or_containment_cycle"));

                var support = entity.Support is null ? null : snapshot.Entities.GetValueOrDefault(entity.Support);
                if (support?.Template == TemplateIds.Room)
                {
                    if (entity.Pos is null)
                    {
                        issues.Add(Issue("room_support_without_pos", path, $"support {entity.Support}"));
                    }
                }
                else if (entity.Pos is not null)
                {
                    issues.Add(Issue("pos_without_room_support", path, $"support {entity.Support ?? "null"}"));
                }

                // Location is derived state: the room at the end of the support or containment chain.
                if (entity.Location is null || snapshot.Entities.ContainsKey(entity.Location))
                {
                    if (Placements.DerivedLocationOf(snapshot, entity.Support, entity.ContainedIn, out var expected)
                        && entity.Location != expected)
                    {
                        issues.Add(Issue("location_mismatch", path, $"location {entity.Location ?? "null"}"));
                    }
                }
            }

            var template = registry.GetValueOrDefault(entity.Template);
            foreach (var part in entity.Parts.Keys.Order(StringComparer.Ordinal))
            {
                var state = entity.Parts[part];
                if (state.Status == PartStatus.Detached && !AccountedFor(snapshot, registry, spawned, id, part))
                {
                    issues.Add(Issue("detached_part_without_entity", [.. path, "parts", part], "detached"));
                }
                // A part at its template default is never stored, so each state has one stored form.
                var decl = template?.Parts.FirstOrDefault(candidate => candidate.Name == part);
                if (decl is not null && PartStates.IsDefault(decl, state))
                {
                    issues.Add(Issue("part_at_default", [.. path, "parts", part], "default"));
                }
                // A severed subtree is stored as its root alone; below it, state lives on the severed entity.
                if (state.Status != PartStatus.Detached
                    && PartStates.Effective(template, entity, part)?.Status == PartStatus.Detached)
                {
                    issues.Add(Issue("part_under_detached", [.. path, "parts", part], StatusName(state.Status)));
                }
            }
        }

        issues.AddRange(HolderPackingIssues(snapshot, registry));
        issues.AddRange(ScheduleIssues(snapshot));
        issues.AddRange(RunIssues(snapshot));
        if (snapshot.Rng is { } rng && !Rng.IsState(rng))
        {
            issues.Add(Issue("invalid_rng", ["rng"], rng.ToString()));
        }
        return issues;
    }

    private static SnapshotIssue Issue(string code, IReadOnlyList<string> path, string message) =>
        new(code, path, message);

    private static string StatusName(PartStatus status) => status.ToString().ToLowerInvariant();

    // The string a prop holds, or null when it holds anything else or nothing.
    private static string? Str(IReadOnlyDictionary<string, JsonNode?> props, string key) =>
        props.TryGetValue(key, out var node) && node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    // JavaScript's truthiness for a prop value: absent, null, false, zero and the empty string are false.
    private static bool Truthy(JsonNode? node)
    {
        if (node is not JsonValue value)
        {
            return false;
        }
        if (value.TryGetValue(out bool flag))
        {
            return flag;
        }
        if (value.TryGetValue(out string? text))
        {
            return text.Length > 0;
        }
        return JsonReads.Number(value) is { } number && number != 0;
    }

    // The ids that close a loop along the relation the caller names, or null: a dangling reference cannot close one.
    private static List<string>? LinkLoop(Snapshot snapshot, string id, Func<Entity, string?> next)
    {
        var path = new List<string>();
        var visited = new Dictionary<string, int>(StringComparer.Ordinal);
        string? current = id;
        while (current is not null)
        {
            if (visited.TryGetValue(current, out var seenAt))
            {
                return [.. path.Skip(seenAt)];
            }
            visited[current] = path.Count;
            path.Add(current);
            if (!snapshot.Entities.TryGetValue(current, out var entity))
            {
                return null;
            }
            current = next(entity);
        }
        return null;
    }

    // One issue per loop, named by its smallest id, so every member of a loop reports it once.
    private static List<SnapshotIssue> LoopIssues(
        List<string>? loop,
        string id,
        HashSet<string> reported,
        IReadOnlyList<string> path,
        string code)
    {
        if (loop is null)
        {
            return [];
        }
        var sorted = loop.Order(StringComparer.Ordinal).ToList();
        var name = sorted.FirstOrDefault() ?? id;
        if (!reported.Add(name))
        {
            return [];
        }
        return [Issue(code, path, $"loop: {string.Join(", ", sorted)}")];
    }

    // Detaching a subtree spawns one entity for its root; a part is accounted for by a detached ancestor that has one.
    private static Dictionary<string, string> DetachedIndex(Snapshot snapshot)
    {
        var index = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var id in snapshot.Entities.Keys.Order(StringComparer.Ordinal))
        {
            var origin = snapshot.Entities[id].DetachedFrom;
            if (origin is not null)
            {
                index[$"{origin.Entity} {origin.Part}"] = id;
            }
        }
        return index;
    }

    private static bool AccountedFor(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        Dictionary<string, string> spawned,
        string ownerId,
        string partName)
    {
        // A part gone when its ancestor was severed rides on the severed entity as detached: the walk follows
        // `detached_from` back to the origin, stopping below the part that origin lost.
        var owners = new HashSet<string>(StringComparer.Ordinal);
        var current = ownerId;
        string? stopAt = null;
        for (;;)
        {
            owners.Add(current);
            var owner = snapshot.Entities.GetValueOrDefault(current);
            var template = owner is null ? null : registry.GetValueOrDefault(owner.Template);
            var visited = new HashSet<string>(StringComparer.Ordinal);
            string? name = partName;
            while (name is not null && name != stopAt)
            {
                if (!visited.Add(name))
                {
                    throw new InvalidOperationException($"Part cycle at {name}");
                }
                if (spawned.ContainsKey($"{current} {name}"))
                {
                    return true;
                }
                name = template?.Parts.FirstOrDefault(part => part.Name == name)?.Parent;
            }
            var origin = owner?.DetachedFrom;
            if (origin is null || owners.Contains(origin.Entity))
            {
                return false;
            }
            current = origin.Entity;
            stopAt = origin.Part;
        }
    }

    // What sits in a plain container fits its inner dimensions: a container that declares none is left alone.
    private static List<SnapshotIssue> ContainerFitIssues(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string id,
        IReadOnlyList<string> path)
    {
        var entity = snapshot.Entities[id];
        if (entity.ContainedIn is null || !snapshot.Entities.TryGetValue(entity.ContainedIn, out var holder) || entity.InPart is not null)
        {
            return [];
        }
        var inner = Fit.InnerDimensions(holder.Props);
        if (inner is null || !registry.TryGetValue(entity.Template, out var template))
        {
            return [];
        }
        var size = template.SizeCm;
        if (Fit.Misfit([size.W, size.D, size.H], inner) is null)
        {
            return [];
        }
        return [Issue("container_contents_too_large", [.. path, "contained_in"], $"holder {holder.Id}")];
    }

    // Traits describe and nothing reads them: at most 16 keys, each a key pattern and an utterance-shaped token.
    private static List<SnapshotIssue> TraitIssues(Entity entity, IReadOnlyList<string> path)
    {
        if (entity.Traits is null)
        {
            return [];
        }
        IReadOnlyList<string> at = [.. path, "traits"];
        var keys = entity.Traits.Keys.Order(StringComparer.Ordinal).ToList();
        if (keys.Count == 0 || keys.Count > MaxTraits)
        {
            return [Issue("invalid_trait", at, keys.Count == 0 ? "empty" : $"{keys.Count} traits")];
        }
        var issues = new List<SnapshotIssue>();
        foreach (var key in keys)
        {
            if (!TraitKey.IsMatch(key))
            {
                issues.Add(Issue("invalid_trait", [.. at, key], "key"));
            }
            else if (!SayVerb.Utterance.IsMatch(entity.Traits[key]))
            {
                issues.Add(Issue("invalid_trait", [.. at, key], "token"));
            }
        }
        return issues;
    }

    private static List<SnapshotIssue> IntegrityIssues(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string id,
        IReadOnlyList<string> path)
    {
        var entity = snapshot.Entities[id];
        var issues = new List<SnapshotIssue>();
        if (entity.Integrity < 0 || entity.Integrity > Limits.MaxIntegrity)
        {
            issues.Add(Issue("integrity_out_of_range", [.. path, "integrity"], $"integrity {entity.Integrity}"));
        }
        // A partless thing is no higher than its template's `max_integrity`, which is 100 when it declares none.
        if (registry.TryGetValue(entity.Template, out var template)
            && template.Parts.Count == 0
            && entity.Integrity > (template.MaxIntegrity ?? Limits.MaxIntegrity))
        {
            issues.Add(Issue("integrity_out_of_range", [.. path, "integrity"], $"integrity {entity.Integrity}"));
        }
        foreach (var part in entity.Parts.Keys.Order(StringComparer.Ordinal))
        {
            var value = entity.Parts[part].Integrity;
            if (value < 0 || value > 100)
            {
                issues.Add(Issue("integrity_out_of_range", [.. path, "parts", part, "integrity"], $"integrity {value}"));
            }
        }
        return issues;
    }

    // A camera whose cone falls short of the whole room must face somewhere (`docs/camera.md`).
    private static List<SnapshotIssue> CameraIssues(Snapshot snapshot, string id, IReadOnlyList<string> path)
    {
        var props = snapshot.Entities[id].Props;
        var cone = PropValues.GetNumber(props, "cone_deg");
        if (cone is null || cone >= Limits.FullCircleDegrees || PropValues.IsNumber(props, "facing_deg"))
        {
            return [];
        }
        return [Issue("camera_without_facing", [.. path, "props", "facing_deg"], "facing_deg")];
    }

    private static List<SnapshotIssue> ReferenceIssues(Snapshot snapshot, string id, IReadOnlyList<string> path)
    {
        var entity = snapshot.Entities[id];
        var issues = new List<SnapshotIssue>();
        // detached_from is history, not a live link, so it is not checked here.
        if (entity.Support is not null && !snapshot.Entities.ContainsKey(entity.Support))
        {
            issues.Add(Issue("dangling_reference", [.. path, "support"], $"unknown entity {entity.Support}"));
        }
        if (entity.ContainedIn is not null && !snapshot.Entities.ContainsKey(entity.ContainedIn))
        {
            issues.Add(Issue("dangling_reference", [.. path, "contained_in"], $"unknown entity {entity.ContainedIn}"));
        }
        if (entity.Location is not null && !snapshot.Entities.ContainsKey(entity.Location))
        {
            issues.Add(Issue("dangling_reference", [.. path, "location"], $"unknown entity {entity.Location}"));
        }
        // A concealer is present or nothing is hidden.
        if (entity.ConcealedBy is not null && !snapshot.Entities.ContainsKey(entity.ConcealedBy))
        {
            issues.Add(Issue("dangling_reference", [.. path, "concealed_by"], $"unknown entity {entity.ConcealedBy}"));
        }
        // Doors name the rooms they join in props: a side that names anything but a room is held to it.
        if (Str(entity.Props, "from") is not null || Str(entity.Props, "to") is not null)
        {
            foreach (var side in new[] { "from", "to" })
            {
                var reference = Str(entity.Props, side);
                if (reference is null)
                {
                    continue;
                }
                if (!snapshot.Entities.TryGetValue(reference, out var target))
                {
                    issues.Add(Issue("dangling_reference", [.. path, "props", side], $"unknown entity {reference}"));
                }
                else if (target.Template != TemplateIds.Room)
                {
                    issues.Add(Issue("door_side_not_room", [.. path, "props", side], $"template {target.Template}"));
                }
            }
        }
        foreach (var link in new[] { "powered_by", "controlled_by" })
        {
            var reference = Str(entity.Props, link);
            if (reference is not null && !snapshot.Entities.ContainsKey(reference))
            {
                issues.Add(Issue("dangling_reference", [.. path, "props", link], $"unknown entity {reference}"));
            }
        }
        // A key's `opens` outlives the lock it names: an absent target is left alone, one that cannot be opened is not.
        var opens = Str(entity.Props, "opens");
        if (opens is not null && snapshot.Entities.TryGetValue(opens, out var openTarget) && !PropValues.IsTrue(openTarget.Props, "openable"))
        {
            issues.Add(Issue("opens_target_not_openable", [.. path, "props", "opens"], opens));
        }
        // A door is closing only while it is open with its shut pending.
        if (PropValues.IsTrue(entity.Props, "closing"))
        {
            var shutting = PropValues.IsTrue(entity.Props, "open")
                && (snapshot.Schedule ?? []).Any(cause => cause.Kind == "close" && cause.Entity == entity.Id);
            if (!shutting)
            {
                issues.Add(Issue("closing_without_close", [.. path, "props", "closing"], entity.Id));
            }
        }
        return issues;
    }

    // What may hide what: a thing there, in the same room, and neither end abstract. Nothing hides itself or what hides it.
    private static List<SnapshotIssue> ConcealmentIssues(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        HashSet<string> reportedLoops,
        string id,
        IReadOnlyList<string> path)
    {
        var entity = snapshot.Entities[id];
        if (entity.ConcealedBy is null || !snapshot.Entities.TryGetValue(entity.ConcealedBy, out var concealer))
        {
            return [];
        }
        var issues = new List<SnapshotIssue>();
        if (Resolve.IsAbstract(registry, entity) || Resolve.IsAbstract(registry, concealer))
        {
            issues.Add(Issue("concealed_by_abstract", path, entity.ConcealedBy));
        }
        if (entity.Location is null || entity.Location != concealer.Location)
        {
            issues.Add(Issue("concealed_by_not_same_room", path, $"{entity.Location ?? "null"} {concealer.Location ?? "null"}"));
        }
        issues.AddRange(LoopIssues(LinkLoop(snapshot, id, next => next.ConcealedBy), id, reportedLoops, path, "concealed_by_cycle"));
        return issues;
    }

    private static List<SnapshotIssue> HolderIssues(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string id,
        IReadOnlyList<string> path)
    {
        var entity = snapshot.Entities[id];
        if (entity.ContainedIn is null)
        {
            return entity.InPart is null
                ? []
                : [Issue("in_part_holder_mismatch", [.. path, "in_part"], $"in_part {entity.InPart}")];
        }
        // A missing holder already has its dangling_reference; the rules below read the other end.
        if (!snapshot.Entities.TryGetValue(entity.ContainedIn, out var holder))
        {
            return [];
        }
        var layout = Carry.HolderLayout(registry, holder.Template);
        var declared = layout.Grips.Concat(layout.Spaces.Select(space => space.Name)).ToList();
        if (entity.InPart is null)
        {
            return declared.Count == 0
                ? []
                : [Issue("in_part_holder_mismatch", [.. path, "in_part"], $"holder {entity.ContainedIn}")];
        }
        if (declared.Count == 0)
        {
            return [Issue("in_part_holder_mismatch", [.. path, "in_part"], $"in_part {entity.InPart}")];
        }
        if (!declared.Contains(entity.InPart))
        {
            return [Issue("in_part_unknown_part", [.. path, "in_part"], entity.InPart)];
        }
        if (!Carry.PartAvailable(snapshot, registry, entity.ContainedIn, entity.InPart))
        {
            return [Issue("in_part_unavailable", [.. path, "in_part"], entity.InPart)];
        }
        return [];
    }

    private static List<SnapshotIssue> PropIssues(
        IReadOnlyDictionary<string, Template> registry,
        Entity entity,
        IReadOnlyList<string> path)
    {
        var issues = new List<SnapshotIssue>();
        var template = registry.GetValueOrDefault(entity.Template);
        foreach (var (name, value) in entity.Props)
        {
            issues.AddRange(PropValueIssues(template, name, value, [.. path, "props", name]));
        }
        return issues;
    }

    // The problems one prop of an entity would have with this value, against the engine's table or the template's own
    // `fields`, and each `requires` met by the template's own props.
    internal static List<SnapshotIssue> PropValueIssues(
        Template? template,
        string name,
        JsonNode? value,
        IReadOnlyList<string> path)
    {
        var issues = new List<SnapshotIssue>();
        PropFields.Table.TryGetValue(name, out var engine);
        var declaredType = engine?.Type;
        if (engine is null && template?.Fields is { } fields && fields.TryGetValue(name, out var field))
        {
            declaredType = ParseType(field.Type);
        }
        if (engine is not null || declaredType is not null)
        {
            if (declaredType is null || !PropFields.Matches(declaredType.Value, value))
            {
                issues.Add(Issue("wrong_prop_type", path, $"props.{name} must be {declaredType?.ToString().ToLowerInvariant() ?? "declared"}"));
            }
        }
        else
        {
            issues.Add(Issue("undeclared_prop", path, $"props.{name} is not a declared prop"));
        }
        if (engine?.Min is { } min && PropFields.Number(value) is { } number && number < min)
        {
            issues.Add(Issue("wrong_prop_type", path, $"props.{name} must be at least {min}"));
        }
        if (engine?.Requires is { } requires && requires.Any(required => template is null || !Truthy(template.Props.GetValueOrDefault(required))))
        {
            issues.Add(Issue("unmet_requires", path, $"props.{name} requires {string.Join(", ", requires)}"));
        }
        return issues;
    }

    private static PropType? ParseType(string type) => type switch
    {
        "boolean" => PropType.Boolean,
        "integer" => PropType.Integer,
        "string" => PropType.String,
        "id" => PropType.Id,
        _ => null,
    };

    // Grip packing and space fit read the holder's whole contents, so they run once per holder.
    private static List<SnapshotIssue> HolderPackingIssues(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry)
    {
        var issues = new List<SnapshotIssue>();
        var holders = snapshot.Entities.Values
            .Where(entity => entity.ContainedIn is not null)
            .Select(entity => entity.ContainedIn!)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal);
        foreach (var holderId in holders)
        {
            if (!snapshot.Entities.TryGetValue(holderId, out var holder) || !registry.ContainsKey(holder.Template))
            {
                continue;
            }
            var layout = Carry.HolderLayout(registry, holder.Template);
            if (layout.Grips.Count == 0 && layout.Spaces.Count == 0)
            {
                continue;
            }
            var grips = layout.Grips.Where(grip => Carry.PartAvailable(snapshot, registry, holderId, grip)).ToList();
            var gripHeld = Carry.HeldInParts(snapshot, holderId).Where(item => grips.Contains(item.InPart)).ToList();
            if (Carry.PackGrips(grips, gripHeld) is null)
            {
                issues.Add(Issue("grip_occupied", ["entities", holderId], $"holder {holderId}"));
            }
            foreach (var (spaceName, inner) in layout.Spaces)
            {
                if (!Carry.PartAvailable(snapshot, registry, holderId, spaceName))
                {
                    continue;
                }
                var oversized = Carry.HeldInParts(snapshot, holderId)
                    .Where(item => item.InPart == spaceName)
                    .FirstOrDefault(item =>
                    {
                        var template = registry.GetValueOrDefault(snapshot.Entities[item.Id].Template);
                        return template is not null
                            && Fit.Misfit([template.SizeCm.W, template.SizeCm.D, template.SizeCm.H], [.. inner.Select(v => (double)v)]) is not null;
                    });
                if (oversized is not null)
                {
                    issues.Add(Issue("part_contents_too_large", ["entities", oversized.Id, "in_part"], spaceName));
                    break;
                }
            }
        }
        return issues;
    }

    // The run states and why one ends, as the snapshot stores them (src/engine/validate.ts).
    private static readonly HashSet<string> RunStates = ["registering", "running", "ended"];
    private static readonly HashSet<string> RunReasons = ["director", "tick_limit", "no_live_players"];

    // A run as stored: a positive tick limit, or the agents that are its slots, each named once, or both, and its state. An
    // ended run has its reason and its tick, and nothing still scheduled (`docs/run.md`).
    private static List<SnapshotIssue> RunIssues(Snapshot snapshot)
    {
        var run = snapshot.Run;
        if (run is null)
        {
            return [];
        }
        var issues = new List<SnapshotIssue>();
        if (run.TickLimit is null && run.Slots is null && run.Pool is null && run.Odds is null)
        {
            issues.Add(Issue("invalid_run", ["run"], "neither tick_limit nor slots"));
        }
        if (run.TickLimit is { } limit && limit < 1)
        {
            issues.Add(Issue("invalid_run", ["run", "tick_limit"], limit.ToString(CultureInfo.InvariantCulture)));
        }
        if (run.Slots is { } slots)
        {
            if (slots.Count == 0)
            {
                issues.Add(Issue("invalid_run", ["run", "slots"], "empty"));
            }
            // Each body is named once across the slots; a slot of several is a list of them, never empty.
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < slots.Count; index++)
            {
                var entry = slots[index];
                var members = Runs.SlotMembers(entry);
                if (members.Count == 0)
                {
                    issues.Add(Issue("invalid_run", ["run", "slots", index.ToString(CultureInfo.InvariantCulture)], "empty"));
                }
                for (var member = 0; member < members.Count; member++)
                {
                    var slot = members[member];
                    IReadOnlyList<string> path = entry is JsonArray
                        ? ["run", "slots", index.ToString(CultureInfo.InvariantCulture), member.ToString(CultureInfo.InvariantCulture)]
                        : ["run", "slots", index.ToString(CultureInfo.InvariantCulture)];
                    // A slot may be gone, which ends the run as a destroyed one does; one still in the world is an agent's body.
                    var body = snapshot.Entities.GetValueOrDefault(slot);
                    var repeated = !seen.Add(slot);
                    if ((body is not null && !PropValues.IsTrue(body.Props, "agent")) || repeated)
                    {
                        issues.Add(Issue("invalid_run", path, slot));
                    }
                }
            }
        }
        // Each player is bound to one of the run's slots by its first body, once per handle and once per slot.
        var roots = Runs.SlotRoots(snapshot);
        var handles = new HashSet<string>(StringComparer.Ordinal);
        var bound = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < (run.Players?.Count ?? 0); index++)
        {
            var player = run.Players![index];
            var known = roots.Contains(player.Slot);
            if (!known || handles.Contains(player.Handle) || bound.Contains(player.Slot))
            {
                issues.Add(Issue("invalid_run", ["run", "players", index.ToString(CultureInfo.InvariantCulture)], player.Handle));
            }
            handles.Add(player.Handle);
            bound.Add(player.Slot);
        }
        if (!RunStates.Contains(run.State))
        {
            issues.Add(Issue("invalid_run", ["run", "state"], run.State));
        }
        if (run.State == "ended")
        {
            if (run.Ended is null || !RunReasons.Contains(run.Ended.Reason))
            {
                issues.Add(Issue("invalid_run", ["run", "ended"], "no reason"));
            }
            if (snapshot.Schedule is { Count: > 0 })
            {
                issues.Add(Issue("invalid_run", ["run", "ended"], "schedule after the end"));
            }
        }
        else if (run.Ended is not null)
        {
            issues.Add(Issue("invalid_run", ["run", "ended"], "not ended"));
        }
        return issues;
    }

    // What is pending is stored one way: no empty list, every cause still ahead of the clock, in due order, on an
    // entity that exists, with the kind's own rule holding. Only the `close` and `bleed` kinds are ported.
    private static List<SnapshotIssue> ScheduleIssues(Snapshot snapshot)
    {
        if (snapshot.Schedule is null)
        {
            return [];
        }
        if (snapshot.Schedule.Count == 0)
        {
            return [Issue("empty_schedule", ["schedule"], "empty")];
        }
        var issues = new List<SnapshotIssue>();
        var previous = long.MinValue;
        var running = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < snapshot.Schedule.Count; index++)
        {
            var cause = snapshot.Schedule[index];
            var path = new[] { "schedule", index.ToString() };
            if (cause.Kind is not ("close" or "bleed" or "process" or "beat"))
            {
                issues.Add(Issue("unknown_cause_kind", path, cause.Kind));
            }
            if (cause.DueTick <= snapshot.Tick)
            {
                issues.Add(Issue("schedule_not_ahead", path, $"due {cause.DueTick} at tick {snapshot.Tick}"));
            }
            else if (cause.DueTick < previous)
            {
                issues.Add(Issue("schedule_unordered", path, $"due {cause.DueTick} after {previous}"));
            }
            previous = Math.Max(previous, cause.DueTick);
            if (!snapshot.Entities.ContainsKey(cause.Entity))
            {
                issues.Add(Issue("schedule_dangling", path, cause.Entity));
            }
            // A process runs at most once at a time on an entity: reconcile never schedules a second.
            if (cause.Kind == "process")
            {
                var key = $"{cause.Entity}/{cause.Process ?? "undefined"}";
                if (!running.Add(key))
                {
                    issues.Add(Issue("duplicate_process", path, key));
                }
            }
            if (cause.Kind == "bleed" && !(cause.Remaining is { } remaining && remaining > 0))
            {
                issues.Add(Issue("bleed_not_remaining", path, $"remaining {cause.Remaining?.ToString() ?? "null"}"));
            }
            if (cause.Kind == "process" && string.IsNullOrEmpty(cause.Process))
            {
                issues.Add(Issue("invalid_process", path, cause.Process ?? "undefined"));
            }
            if (cause.Kind == "beat" && Beats.Invalid(cause) is { } broken)
            {
                issues.Add(Issue("invalid_beat", path, broken));
            }
        }
        // Beats share one namespace of ids, their followers' included, and a bounded number of them.
        var ids = Beats.PendingBeatIds(snapshot.Schedule);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in ids)
        {
            if (!seen.Add(id))
            {
                issues.Add(Issue("duplicate_beat", ["schedule"], id));
            }
        }
        if (ids.Count > Beats.MaxBeats)
        {
            issues.Add(Issue("too_many_beats", ["schedule"], ids.Count.ToString()));
        }
        return issues;
    }
}
