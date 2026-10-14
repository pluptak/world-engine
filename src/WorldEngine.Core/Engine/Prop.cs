using System.Text.Json.Nodes;
using WorldEngine.Core.Json;

namespace WorldEngine.Core.Engine;

// A prop the engine reads, named once: its JSON key and its row in the prop table. The type parameter is what a read gives
// back (`bool`, `long`, or `string` for both strings and ids). It converts to its key, for writes and for string-keyed APIs.
public sealed record Prop<T>(string Name, PropField Field)
{
    public static implicit operator string(Prop<T> prop) => prop.Name;

    public override string ToString() => Name;
}

// The engine's prop table (`docs/fields.md`): every prop the engine reads, its type, who may write it, and what it requires,
// with the typed reads of a props bag. A prop no code reads is declared by its template under `fields`.
public static class Prop
{
    // Declared before the props, which add themselves to it as they are made.
    private static readonly List<(string Name, PropField Field)> Declared = [];

    public static readonly Prop<bool> Abstract = Flag("abstract", Tier.Definition);
    public static readonly Prop<bool> Agent = Flag("agent", Tier.Definition);
    // A sleeping body acts on nothing and senses only by touch and smell (`docs/senses.md`); an author sets it.
    public static readonly Prop<bool> Asleep = Flag("asleep", Tier.State);
    public static readonly Prop<long> AttackDamage = Integer("attack_damage", Tier.Definition);
    public static readonly Prop<bool> Barrier = Flag("barrier", Tier.Definition);
    public static readonly Prop<long> BiteDamage = Integer("bite_damage", Tier.Definition);
    public static readonly Prop<long> BleedDamage = Integer("bleed_damage", Tier.Definition);
    public static readonly Prop<long> BleedEveryTicks = Integer("bleed_every_ticks", Tier.Definition);
    public static readonly Prop<long> BleedTimes = Integer("bleed_times", Tier.Definition);
    public static readonly Prop<long> BreakFallCm = Integer("break_fall_cm", Tier.Definition);
    public static readonly Prop<bool> Burning = Flag("burning", Tier.State, requires: ["light_source"]);
    public static readonly Prop<bool> Camera = Flag("camera", Tier.Definition);
    public static readonly Prop<long> CapacityCm3 = Integer("capacity_cm3", Tier.Definition, min: 1);
    public static readonly Prop<long> CarryLimitG = Integer("carry_limit_g", Tier.Definition);
    public static readonly Prop<long> ClosesAfter = Integer("closes_after", Tier.Definition, requires: ["openable"]);
    public static readonly Prop<bool> Closing = Flag("closing", Tier.State, requires: ["openable"]);
    // The whole angle a camera sees, centred on its facing; absent or 360 is the whole room (`docs/camera.md`).
    public static readonly Prop<long> ConeDeg = Integer("cone_deg", Tier.Definition, min: 1, max: 360, requires: ["camera"]);
    public static readonly Prop<bool> Container = Flag("container", Tier.Definition, requires: ["inner_w_cm", "inner_d_cm", "inner_h_cm"]);
    public static readonly Prop<string> ControlledBy = Id("controlled_by", Tier.State);
    public static readonly Prop<string> DefaultHitPart = Text("default_hit_part", Tier.Definition);
    // The way a camera looks, in degrees counter-clockwise from +x, and the whole angle it sees (`docs/camera.md`).
    public static readonly Prop<long> FacingDeg = Integer("facing_deg", Tier.State, min: 0, max: 359, requires: ["camera"]);
    public static readonly Prop<string> From = Id("from", Tier.State, requires: ["openable"]);
    public static readonly Prop<long> Fuel = Integer("fuel", Tier.State, requires: ["light_source"]);
    public static readonly Prop<long> GapCm = Integer("gap_cm", Tier.Definition, requires: ["barrier"]);
    // A gauge marked on a vessel or a light: how fine a look reads its amount, in percent.
    public static readonly Prop<long> GaugePct = Integer("gauge_pct", Tier.Definition, min: 1, max: 25, divides: 100);
    public static readonly Prop<long> HandCarryLimitG = Integer("hand_carry_limit_g", Tier.Definition);
    public static readonly Prop<long> HandHeightCm = Integer("hand_height_cm", Tier.Definition);
    public static readonly Prop<long> HandsRequired = Integer("hands_required", Tier.Definition);
    public static readonly Prop<long> Hunger = Integer("hunger", Tier.State);
    public static readonly Prop<long> InnerDCm = Integer("inner_d_cm", Tier.Definition);
    public static readonly Prop<long> InnerHCm = Integer("inner_h_cm", Tier.Definition);
    public static readonly Prop<long> InnerWCm = Integer("inner_w_cm", Tier.Definition);
    public static readonly Prop<bool> Intercom = Flag("intercom", Tier.Definition);
    // The chance, in percent, that a remote command to this device is jammed (`docs/jam.md`).
    public static readonly Prop<long> JamPct = Integer("jam_pct", Tier.Definition, min: 0, max: 100, requires: ["openable"]);
    public static readonly Prop<bool> LightSource = Flag("light_source", Tier.Definition);
    public static readonly Prop<long> LiquidAmount = Integer("liquid_amount", Tier.State);
    public static readonly Prop<string> LiquidMaterial = Text("liquid_material", Tier.State);
    public static readonly Prop<long> LiquidNutrition = Integer("liquid_nutrition", Tier.Definition);
    public static readonly Prop<bool> Lit = Flag("lit", Tier.State);
    public static readonly Prop<bool> Locked = Flag("locked", Tier.State, requires: ["openable"]);
    public static readonly Prop<long> Nutrition = Integer("nutrition", Tier.Definition);
    public static readonly Prop<bool> On = Flag("on", Tier.State);
    public static readonly Prop<bool> Open = Flag("open", Tier.State, requires: ["openable"]);
    public static readonly Prop<bool> Openable = Flag("openable", Tier.Definition);
    public static readonly Prop<string> Opens = Id("opens", Tier.State);
    // A panel: a link a subject at it may work its device through (`docs/panel.md`).
    public static readonly Prop<bool> Panel = Flag("panel", Tier.Definition);
    public static readonly Prop<long> Portions = Integer("portions", Tier.State);
    public static readonly Prop<bool> PowerSource = Flag("power_source", Tier.Definition);
    public static readonly Prop<string> PoweredBy = Id("powered_by", Tier.State);
    public static readonly Prop<long> ReachCm = Integer("reach_cm", Tier.Definition);
    public static readonly Prop<bool> Rubble = Flag("rubble", Tier.Definition);
    public static readonly Prop<bool> Scenery = Flag("scenery", Tier.Definition);
    public static readonly Prop<long> ShutTicks = Integer("shut_ticks", Tier.Definition, min: 1, requires: ["openable"]);
    // A body that is destroyed leaves an agent of this template where it lay (`docs/templates.md`).
    public static readonly Prop<string> Successor = Text("successor", Tier.Definition);
    // The body a successor took over from: a history reference, never a link that must still be there.
    public static readonly Prop<string> Succeeds = Text("succeeds", Tier.State);
    public static readonly Prop<bool> Surface = Flag("surface", Tier.Definition);
    public static readonly Prop<string> To = Id("to", Tier.State, requires: ["openable"]);
    public static readonly Prop<bool> Topples = Flag("topples", Tier.Definition);
    // An unconscious body takes every sense and capacity until an author's edit ends it (`docs/senses.md`).
    public static readonly Prop<bool> Unconscious = Flag("unconscious", Tier.State);

    public static readonly IReadOnlyDictionary<string, PropField> Table =
        Declared.ToDictionary(row => row.Name, row => row.Field, StringComparer.Ordinal);

    // The props that name another entity (`from`, `to`, `opens`, `powered_by`, `controlled_by`): a scene writes them by name.
    public static readonly IReadOnlyList<string> References =
        [.. Declared.Where(row => row.Field.Type == PropType.Id).Select(row => row.Name)];

    // True only when the prop holds `true`; absent or anything else is not.
    public static bool Is(this IReadOnlyDictionary<string, JsonNode?> props, Prop<bool> prop) =>
        JsonReads.IsTrue(props.GetValueOrDefault(prop.Name));

    // The flag, or null when the prop is absent or not a boolean (`on` reads absent as on).
    public static bool? Get(this IReadOnlyDictionary<string, JsonNode?> props, Prop<bool> prop) =>
        props.GetValueOrDefault(prop.Name) is JsonValue value && value.TryGetValue(out bool flag) ? flag : null;

    // The whole number that fits a long, or null.
    public static long? Get(this IReadOnlyDictionary<string, JsonNode?> props, Prop<long> prop) =>
        JsonReads.SafeInt(props.GetValueOrDefault(prop.Name));

    public static string? Get(this IReadOnlyDictionary<string, JsonNode?> props, Prop<string> prop) =>
        JsonReads.Text(props.GetValueOrDefault(prop.Name));

    // A copy of the props with one prop set or taken away: a transition writes it through `Working.SetProps`.
    public static Dictionary<string, JsonNode?> With(this IReadOnlyDictionary<string, JsonNode?> props, Prop<bool> prop, bool value) =>
        Copy(props, prop.Name, JsonValue.Create(value));

    public static Dictionary<string, JsonNode?> With(this IReadOnlyDictionary<string, JsonNode?> props, Prop<long> prop, long value) =>
        Copy(props, prop.Name, JsonValue.Create(value));

    public static Dictionary<string, JsonNode?> With(this IReadOnlyDictionary<string, JsonNode?> props, Prop<string> prop, string value) =>
        Copy(props, prop.Name, JsonValue.Create(value));

    public static Dictionary<string, JsonNode?> Without<T>(this IReadOnlyDictionary<string, JsonNode?> props, Prop<T> prop)
    {
        var copy = new Dictionary<string, JsonNode?>(props, StringComparer.Ordinal);
        copy.Remove(prop.Name);
        return copy;
    }

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

    private static Dictionary<string, JsonNode?> Copy(IReadOnlyDictionary<string, JsonNode?> props, string name, JsonNode? value) =>
        new(props, StringComparer.Ordinal) { [name] = value };

    private static Prop<bool> Flag(string name, Tier tier, IReadOnlyList<string>? requires = null) =>
        Declare<bool>(name, new(PropType.Boolean, tier, requires));

    private static Prop<long> Integer(
        string name, Tier tier, long? min = null, long? max = null, long? divides = null, IReadOnlyList<string>? requires = null) =>
        Declare<long>(name, new(PropType.Integer, tier, requires, min, max, divides));

    private static Prop<string> Text(string name, Tier tier, IReadOnlyList<string>? requires = null) =>
        Declare<string>(name, new(PropType.String, tier, requires));

    private static Prop<string> Id(string name, Tier tier, IReadOnlyList<string>? requires = null) =>
        Declare<string>(name, new(PropType.Id, tier, requires));

    private static Prop<T> Declare<T>(string name, PropField field)
    {
        Declared.Add((name, field));
        return new Prop<T>(name, field);
    }
}
