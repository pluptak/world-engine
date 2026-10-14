using System.Text.RegularExpressions;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// A scenario's names (src/scenario.ts `resolveScenario`): every name an entry writes becomes the id it names before any spawn,
// so a bad name is refused before anything is written. Works on the scenario as values, since its output is what a spawn reads.
public static class ScenarioResolver
{
    // The resolved entries (each a scenario entry with its names replaced by ids) and the ids the names named.
    public sealed record Resolved(IReadOnlyList<Value.Map> Scenario, IReadOnlyDictionary<string, string> Ids);

    private static readonly Regex AllocatedId = new(@"^e[1-9][0-9]*\z", RegexOptions.CultureInvariant);
    private static readonly string[] ReferenceFields = ["location", "support", "contained_in", "concealed_by"];
    private static readonly string[] HolderFields = ["location", "support", "contained_in"];

    // Every name is known before any reference is read, so an entry may point forward. Ids follow next_seq in entry order.
    public static Resolved Resolve(Value.List scenario, long nextSeq = 1)
    {
        var entries = scenario.Items.Select(item => item as Value.Map ?? Value.Map.Empty).ToList();
        var allocated = new List<string>(entries.Count);
        for (var index = 0; index < entries.Count; index++)
        {
            allocated.Add($"e{nextSeq + index}");
        }
        var ids = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < entries.Count; index++)
        {
            var name = entries[index].GetValueOrDefault("id").AsText();
            if (name is null)
            {
                continue;
            }
            if (name.Length == 0 || AllocatedId.IsMatch(name))
            {
                throw new WorldError(Code.InvalidName, $"Invalid scenario name {name} at entry {index}");
            }
            if (ids.ContainsKey(name))
            {
                throw new WorldError(Code.DuplicateName, $"Duplicate scenario name {name} at entry {index}");
            }
            ids[name] = allocated[index];
        }

        // A declared name, else a literal id this scenario allocates.
        string? Known(string value) => ids.TryGetValue(value, out var named) ? named : allocated.Contains(value) ? value : null;
        string Reference(string value, int index) =>
            Known(value) ?? throw new WorldError(Code.UnknownName, $"Unknown name {value} at entry {index}");

        var mapped = new List<Value.Map>(entries.Count);
        for (var index = 0; index < entries.Count; index++)
        {
            var entry = entries[index];
            if (entry.GetValueOrDefault("overrides") is not Value.Map overrides)
            {
                mapped.Add(entry.Without("overrides"));
                continue;
            }
            // A pos is kept only when it is a position; an anchor is resolved below, and anything else is no position at all.
            var resolved = IsPos(overrides.GetValueOrDefault("pos")) ? overrides : overrides.Without("pos");
            foreach (var field in ReferenceFields)
            {
                if (overrides.GetValueOrDefault(field).AsText() is { } name)
                {
                    resolved = resolved.With(field, Reference(name, index));
                }
            }
            if (overrides.GetValueOrDefault("detached_from") is Value.Map detached)
            {
                resolved = resolved.With(
                    "detached_from",
                    detached.With("entity", Reference(detached.GetValueOrDefault("entity").AsText() ?? "", index)));
            }
            if (overrides.GetValueOrDefault("props") is Value.Map props)
            {
                foreach (var key in Prop.References)
                {
                    if (props.GetValueOrDefault(key).AsText() is { } name)
                    {
                        props = props.With(key, Reference(name, index));
                    }
                }
                resolved = resolved.With("props", props);
            }
            mapped.Add(entry.With("overrides", resolved));
        }

        // Read after every reference is resolved, so an anchor may be named forward.
        var byId = new Dictionary<string, Value.Map>(StringComparer.Ordinal);
        for (var index = 0; index < mapped.Count; index++)
        {
            byId[allocated[index]] = mapped[index];
        }

        var output = new List<Value.Map>(mapped.Count);
        for (var index = 0; index < mapped.Count; index++)
        {
            var entry = mapped[index];
            // Read from the entry as written: the pass above kept only the positions it could resolve.
            var overrides = entries[index].GetValueOrDefault("overrides") as Value.Map;
            if (overrides?.GetValueOrDefault("pos") is not Value.Map written || !IsAnchorPos(written))
            {
                output.Add(entry);
                continue;
            }
            // An anchor says where the entity is, so it cannot sit beside a holder the author also named.
            if (HolderFields.Any(overrides.ContainsKey))
            {
                throw new WorldError(Code.ConflictingPlacement, $"Entry {index} names a holder and an anchor position");
            }
            var anchorName = written.GetValueOrDefault("anchor").AsText() ?? "";
            var anchorId = Known(anchorName)
                ?? throw new WorldError(Code.UnknownAnchor, $"Unknown anchor {anchorName} at entry {index}");
            var anchorOverrides = byId.GetValueOrDefault(anchorId)?.GetValueOrDefault("overrides") as Value.Map;
            var room = anchorOverrides?.GetValueOrDefault("support").AsText();
            var origin = anchorOverrides?.GetValueOrDefault("pos") as Value.Map;
            var roomTemplate = room is null ? null : byId.GetValueOrDefault(room)?.GetValueOrDefault("template").AsText();
            // An anchor is a fixed point: it stands in a room, and its own position is not another anchor.
            if (room is null || roomTemplate != TemplateIds.Room || origin is null || !IsPos(origin))
            {
                throw new WorldError(Code.AnchorNotRoomSupported, $"Anchor {anchorName} at entry {index} is not a fixed point in a room");
            }
            // The offset becomes a stored pos and the anchor's room the holder. The anchor is not recorded: the entity is simply in
            // that room at that position, exactly as if it had been written there.
            var pos = Value.Map.Empty
                .With("x", origin.GetValueOrDefault("x").AsInt()!.Value + written.GetValueOrDefault("dx").AsInt()!.Value)
                .With("y", origin.GetValueOrDefault("y").AsInt()!.Value + written.GetValueOrDefault("dy").AsInt()!.Value);
            var placed = (Value.Map)entry["overrides"];
            output.Add(entry.With("overrides", placed.With("location", room).With("support", room).With("pos", pos)));
        }

        return new Resolved(output, ids);
    }

    // A plain position: x and y, two whole numbers, and nothing else.
    private static bool IsPos(Value? value) =>
        value is Value.Map map
        && map.Keys.All(key => key is "x" or "y")
        && map.GetValueOrDefault("x") is Value.Int
        && map.GetValueOrDefault("y") is Value.Int;

    // An anchor position: the name of an entity and two whole offsets, and nothing else.
    private static bool IsAnchorPos(Value.Map map) =>
        map.Keys.All(key => key is "anchor" or "dx" or "dy")
        && map.GetValueOrDefault("anchor") is Value.Text
        && map.GetValueOrDefault("dx") is Value.Int
        && map.GetValueOrDefault("dy") is Value.Int;
}
