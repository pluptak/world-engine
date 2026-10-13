using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using System.Text.RegularExpressions;
using static WorldEngine.Core.Engine.JsonReads;

namespace WorldEngine.Core.Engine;

// A scenario's names (src/scenario.ts `resolveScenario`): every name an entry writes becomes the id it names before any spawn,
// so a bad name is refused before anything is written. Works on the scenario as JSON, since its output is what a spawn reads.
public static class ScenarioResolver
{
    // The resolved entries (each a scenario entry with its names replaced by ids) and the ids the names named.
    public sealed record Resolved(JsonArray Scenario, IReadOnlyDictionary<string, string> Ids);

    private static readonly Regex AllocatedId = new(@"^e[1-9][0-9]*\z", RegexOptions.CultureInvariant);
    private static readonly string[] ReferenceFields = ["location", "support", "contained_in", "concealed_by"];
    private static readonly string[] HolderFields = ["location", "support", "contained_in"];
    private static readonly string[] ReferenceProps = ["from", "to", "opens", "powered_by", "controlled_by"];

    // Every name is known before any reference is read, so an entry may point forward. Ids follow next_seq in entry order.
    public static Resolved Resolve(JsonArray scenario, long nextSeq = 1)
    {
        var allocated = new List<string>(scenario.Count);
        for (var index = 0; index < scenario.Count; index++)
        {
            allocated.Add($"e{nextSeq + index}");
        }
        var ids = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < scenario.Count; index++)
        {
            var name = Text(scenario[index]?["id"]);
            if (name is null)
            {
                continue;
            }
            if (name.Length == 0 || AllocatedId.IsMatch(name))
            {
                throw new WorldError("invalid_name", $"Invalid scenario name {name} at entry {index}");
            }
            if (ids.ContainsKey(name))
            {
                throw new WorldError("duplicate_name", $"Duplicate scenario name {name} at entry {index}");
            }
            ids[name] = allocated[index];
        }

        // A declared name, else a literal id this scenario allocates.
        string? Known(string value) => ids.TryGetValue(value, out var named) ? named : allocated.Contains(value) ? value : null;
        string Reference(string value, int index) =>
            Known(value) ?? throw new WorldError("unknown_name", $"Unknown name {value} at entry {index}");

        var mapped = new List<JsonObject>(scenario.Count);
        for (var index = 0; index < scenario.Count; index++)
        {
            var entry = scenario[index]!.AsObject();
            if (entry["overrides"] is not JsonObject overrides)
            {
                var bare = (JsonObject)entry.DeepClone();
                bare.Remove("overrides");
                mapped.Add(bare);
                continue;
            }
            // A pos is kept only when it is a position; an anchor is resolved below, and anything else is no position at all.
            var resolved = new JsonObject();
            foreach (var (key, value) in overrides)
            {
                if (key != "pos")
                {
                    resolved[key] = value?.DeepClone();
                }
            }
            if (IsPos(overrides["pos"]))
            {
                resolved["pos"] = overrides["pos"]!.DeepClone();
            }
            foreach (var field in ReferenceFields)
            {
                if (Text(overrides[field]) is { } name)
                {
                    resolved[field] = JsonValue.Create(Reference(name, index));
                }
            }
            if (overrides["detached_from"] is JsonObject detached)
            {
                var origin = (JsonObject)detached.DeepClone();
                origin["entity"] = JsonValue.Create(Reference(Text(detached["entity"]) ?? "", index));
                resolved["detached_from"] = origin;
            }
            if (overrides["props"] is JsonObject props)
            {
                var copy = new JsonObject();
                foreach (var (key, value) in props)
                {
                    copy[key] = value?.DeepClone();
                }
                foreach (var key in ReferenceProps)
                {
                    if (Text(copy[key]) is { } name)
                    {
                        copy[key] = JsonValue.Create(Reference(name, index));
                    }
                }
                resolved["props"] = copy;
            }
            var withResolved = (JsonObject)entry.DeepClone();
            withResolved["overrides"] = resolved;
            mapped.Add(withResolved);
        }

        // Read after every reference is resolved, so an anchor may be named forward.
        var byId = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        for (var index = 0; index < mapped.Count; index++)
        {
            byId[allocated[index]] = mapped[index];
        }

        var output = new JsonArray();
        for (var index = 0; index < mapped.Count; index++)
        {
            var entry = mapped[index];
            // Read from the entry as written: the pass above kept only the positions it could resolve.
            var written = scenario[index]!["overrides"]?["pos"];
            if (!IsAnchorPos(written))
            {
                output.Add(entry);
                continue;
            }
            var overrides = scenario[index]!["overrides"]!.AsObject();
            // An anchor says where the entity is, so it cannot sit beside a holder the author also named.
            if (HolderFields.Any(field => overrides[field] is not null))
            {
                throw new WorldError("conflicting_placement", $"Entry {index} names a holder and an anchor position");
            }
            var anchorName = Text(written!["anchor"]) ?? "";
            var anchorId = Known(anchorName)
                ?? throw new WorldError("unknown_anchor", $"Unknown anchor {anchorName} at entry {index}");
            var anchor = byId.GetValueOrDefault(anchorId);
            var anchorOverrides = anchor?["overrides"] as JsonObject;
            var room = Text(anchorOverrides?["support"]);
            var origin = anchorOverrides?["pos"] as JsonObject;
            var roomTemplate = room is null ? null : Text(byId.GetValueOrDefault(room)?["template"]);
            // An anchor is a fixed point: it stands in a room, and its own position is not another anchor.
            if (anchor is null || room is null || roomTemplate != TemplateIds.Room || !IsPos(origin))
            {
                throw new WorldError("anchor_not_room_supported", $"Anchor {anchorName} at entry {index} is not a fixed point in a room");
            }
            // The offset becomes a stored pos and the anchor's room the holder. The anchor is not recorded: the entity is simply in
            // that room at that position, exactly as if it had been written there.
            var placed = (JsonObject)entry.DeepClone();
            var placedOverrides = (JsonObject)placed["overrides"]!;
            placedOverrides["location"] = JsonValue.Create(room);
            placedOverrides["support"] = JsonValue.Create(room);
            placedOverrides["pos"] = new JsonObject
            {
                ["x"] = JsonValue.Create(SafeInt(origin!["x"])!.Value + SafeInt(written["dx"])!.Value),
                ["y"] = JsonValue.Create(SafeInt(origin["y"])!.Value + SafeInt(written["dy"])!.Value),
            };
            output.Add(placed);
        }

        return new Resolved(output, ids);
    }

    // A plain position: an object of two safe integers, x and y, and nothing else.
    private static bool IsPos(JsonNode? node) =>
        node is JsonObject obj
        && obj.All(pair => pair.Key is "x" or "y")
        && SafeInt(obj["x"]) is not null
        && SafeInt(obj["y"]) is not null;

    // An anchor position: the name of an entity and two safe integer offsets, and nothing else.
    private static bool IsAnchorPos(JsonNode? node) =>
        node is JsonObject obj
        && obj.All(pair => pair.Key is "anchor" or "dx" or "dy")
        && Text(obj["anchor"]) is not null
        && SafeInt(obj["dx"]) is not null
        && SafeInt(obj["dy"]) is not null;
}
