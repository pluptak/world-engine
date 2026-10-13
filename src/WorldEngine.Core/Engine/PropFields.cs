using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using WorldEngine.Core.Json;

namespace WorldEngine.Core.Engine;

// The engine's prop table (src/engine/fields.ts): every prop the engine reads, its type, who may write it,
// and what it requires. A prop no code reads is declared by its template under `fields`.

public enum PropType
{
    [JsonStringEnumMemberName("boolean")] Boolean,
    [JsonStringEnumMemberName("integer")] Integer,
    [JsonStringEnumMemberName("string")] String,
    [JsonStringEnumMemberName("id")] Id,
}

public enum Tier
{
    [JsonStringEnumMemberName("definition")] Definition,
    [JsonStringEnumMemberName("state")] State,
    [JsonStringEnumMemberName("derived")] Derived,
}

public sealed record PropField(
    PropType Type,
    Tier Tier,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Requires = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Min = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Max = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Divides = null);

public static class PropFields
{
    public static readonly IReadOnlyDictionary<string, PropField> Table = new Dictionary<string, PropField>(StringComparer.Ordinal)
    {
        ["abstract"] = new(PropType.Boolean, Tier.Definition),
        ["agent"] = new(PropType.Boolean, Tier.Definition),
        // A sleeping body acts on nothing and senses only by touch and smell (`docs/senses.md`); an author sets it.
        ["asleep"] = new(PropType.Boolean, Tier.State),
        ["attack_damage"] = new(PropType.Integer, Tier.Definition),
        ["barrier"] = new(PropType.Boolean, Tier.Definition),
        ["bite_damage"] = new(PropType.Integer, Tier.Definition),
        ["bleed_damage"] = new(PropType.Integer, Tier.Definition),
        ["bleed_every_ticks"] = new(PropType.Integer, Tier.Definition),
        ["bleed_times"] = new(PropType.Integer, Tier.Definition),
        ["break_fall_cm"] = new(PropType.Integer, Tier.Definition),
        ["burning"] = new(PropType.Boolean, Tier.State, Requires: ["light_source"]),
        ["camera"] = new(PropType.Boolean, Tier.Definition),
        ["capacity_cm3"] = new(PropType.Integer, Tier.Definition, Min: 1),
        ["carry_limit_g"] = new(PropType.Integer, Tier.Definition),
        ["closes_after"] = new(PropType.Integer, Tier.Definition, Requires: ["openable"]),
        ["closing"] = new(PropType.Boolean, Tier.State, Requires: ["openable"]),
        // The whole angle a camera sees, centred on its facing; absent or 360 is the whole room (`docs/camera.md`).
        ["cone_deg"] = new(PropType.Integer, Tier.Definition, Min: 1, Max: 360, Requires: ["camera"]),
        ["container"] = new(PropType.Boolean, Tier.Definition, Requires: ["inner_w_cm", "inner_d_cm", "inner_h_cm"]),
        ["controlled_by"] = new(PropType.Id, Tier.State),
        ["default_hit_part"] = new(PropType.String, Tier.Definition),
        // The way a camera looks, in degrees counter-clockwise from +x, and the whole angle it sees (`docs/camera.md`).
        ["facing_deg"] = new(PropType.Integer, Tier.State, Min: 0, Max: 359, Requires: ["camera"]),
        ["from"] = new(PropType.Id, Tier.State, Requires: ["openable"]),
        ["fuel"] = new(PropType.Integer, Tier.State, Requires: ["light_source"]),
        ["gap_cm"] = new(PropType.Integer, Tier.Definition, Requires: ["barrier"]),
        // A gauge marked on a vessel or a light: how fine a look reads its amount, in percent.
        ["gauge_pct"] = new(PropType.Integer, Tier.Definition, Min: 1, Max: 25, Divides: 100),
        ["hand_carry_limit_g"] = new(PropType.Integer, Tier.Definition),
        ["hand_height_cm"] = new(PropType.Integer, Tier.Definition),
        ["hands_required"] = new(PropType.Integer, Tier.Definition),
        ["hunger"] = new(PropType.Integer, Tier.State),
        ["inner_d_cm"] = new(PropType.Integer, Tier.Definition),
        ["inner_h_cm"] = new(PropType.Integer, Tier.Definition),
        ["inner_w_cm"] = new(PropType.Integer, Tier.Definition),
        ["intercom"] = new(PropType.Boolean, Tier.Definition),
        // The chance, in percent, that a remote command to this device is jammed (`docs/jam.md`).
        ["jam_pct"] = new(PropType.Integer, Tier.Definition, Min: 0, Max: 100, Requires: ["openable"]),
        ["light_source"] = new(PropType.Boolean, Tier.Definition),
        ["liquid_amount"] = new(PropType.Integer, Tier.State),
        ["liquid_material"] = new(PropType.String, Tier.State),
        ["liquid_nutrition"] = new(PropType.Integer, Tier.Definition),
        ["lit"] = new(PropType.Boolean, Tier.State),
        ["locked"] = new(PropType.Boolean, Tier.State, Requires: ["openable"]),
        ["nutrition"] = new(PropType.Integer, Tier.Definition),
        ["on"] = new(PropType.Boolean, Tier.State),
        ["open"] = new(PropType.Boolean, Tier.State, Requires: ["openable"]),
        ["openable"] = new(PropType.Boolean, Tier.Definition),
        ["opens"] = new(PropType.Id, Tier.State),
        // A panel: a link a subject at it may work its device through (`docs/panel.md`).
        ["panel"] = new(PropType.Boolean, Tier.Definition),
        ["portions"] = new(PropType.Integer, Tier.State),
        ["power_source"] = new(PropType.Boolean, Tier.Definition),
        ["powered_by"] = new(PropType.Id, Tier.State),
        ["reach_cm"] = new(PropType.Integer, Tier.Definition),
        ["rubble"] = new(PropType.Boolean, Tier.Definition),
        ["scenery"] = new(PropType.Boolean, Tier.Definition),
        ["shut_ticks"] = new(PropType.Integer, Tier.Definition, Min: 1, Requires: ["openable"]),
        // A body that is destroyed leaves an agent of this template where it lay (`docs/templates.md`).
        ["successor"] = new(PropType.String, Tier.Definition),
        // The body a successor took over from: a history reference, never a link that must still be there.
        ["succeeds"] = new(PropType.String, Tier.State),
        ["surface"] = new(PropType.Boolean, Tier.Definition),
        ["to"] = new(PropType.Id, Tier.State, Requires: ["openable"]),
        ["topples"] = new(PropType.Boolean, Tier.Definition),
        // An unconscious body takes every sense and capacity until an author's edit ends it (`docs/senses.md`).
        ["unconscious"] = new(PropType.Boolean, Tier.State),
    };

    // Whether a prop value (a JSON number, string or boolean) holds the type. An integer is a whole number that fits a long.
    public static bool Matches(PropType type, JsonNode? value)
    {
        var kind = (value as JsonValue)?.GetValueKind();
        return type switch
        {
            PropType.Boolean => kind is System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False,
            PropType.Integer => JsonReads.SafeInt(value) is not null,
            _ => kind is System.Text.Json.JsonValueKind.String,
        };
    }

    // Strict equality of two props (`===` in TypeScript): an absent prop equals nothing, and two values are the same when they
    // read the same.
    public static bool SameValue(JsonNode? left, JsonNode? right) =>
        left is null || right is null
            ? left is null && right is null
            : JsonNode.DeepEquals(left, right);
}
