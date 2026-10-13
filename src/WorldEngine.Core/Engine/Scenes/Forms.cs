using WorldEngine.Core.Model;
using System.Text.Json.Nodes;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Engine.JsonReads;

namespace WorldEngine.Core.Engine;

// What the architect may say about a thing in a scenario instead of a raw quantity (src/engine/forms.ts): whole percentages of what the
// preset holds, and two named levels of condition. Each is converted once, here, to the one stored value (fuel, liquid_amount and
// liquid_material, integrity, hunger, portions), so a form is a second way to write a field and never a second stored field.
// Pure and integer. Works on the overrides as JSON, since the scenario is read that way.
public static class Forms
{
    public static readonly string[] FormKeys = ["fuel_pct", "liquid", "condition", "hunger_pct", "portions_pct"];

    private static readonly HashSet<string> ArchitectFields =
    [
        "name", "aliases", "traits", "location", "support", "contained_in", "in_part", "concealed_by", "pos",
        "fuel_pct", "liquid", "condition", "hunger_pct", "portions_pct",
    ];

    private static readonly HashSet<string> ArchitectProps =
        ["open", "locked", "burning", "lit", "from", "to", "opens", "powered_by", "controlled_by", "facing_deg", "asleep", "unconscious"];

    // A percentage of what the preset holds, floored, except that one above 0 never comes to 0: a candle's 8 fuel at 10% is 1, so it
    // still lights.
    public static long Share(long whole, long percent)
    {
        var part = (long)Math.Floor((double)whole * percent / 100);
        return percent > 0 ? Math.Max(part, 1) : part;
    }

    public static bool HasForms(JsonObject overrides) => FormKeys.Any(overrides.ContainsKey);

    // The overrides with every form converted away. A scenario entry is checked by ArchitectWrites first, so no raw prop a form converts
    // to is beside it: one fact is written one way. A form given as null is given, and refused as the wrong kind of value.
    public static JsonObject Apply(Template template, JsonObject overrides, int index)
    {
        var props = new JsonObject();
        if (overrides["props"] is JsonObject given)
        {
            foreach (var (name, value) in given)
            {
                props[name] = value?.DeepClone();
            }
        }
        var result = new JsonObject();
        foreach (var (key, value) in overrides)
        {
            if (!FormKeys.Contains(key))
            {
                result[key] = value?.DeepClone();
            }
        }

        if (overrides.ContainsKey("fuel_pct"))
        {
            var percent = WholePercent(overrides["fuel_pct"], index, "fuel_pct");
            props["fuel"] = JsonValue.Create(Share(PresetInteger(template, "fuel", index, "fuel_pct"), percent));
        }
        if (overrides.ContainsKey("liquid"))
        {
            var liquid = overrides["liquid"];
            if (liquid is null || !IsLiquidShape(liquid))
            {
                throw Fail("invalid_form", index, "liquid must be { material?, pct }");
            }
            var percent = WholePercent(Member(liquid, "pct"), index, "liquid.pct");
            var material = Member(liquid, "material");
            if (material is not null && (Text(material) is not { } text || text == ""))
            {
                throw Fail("invalid_form", index, "liquid.material must be a non-empty string");
            }
            var capacity = PresetInteger(template, "capacity_cm3", index, "liquid");
            var name = Text(material) ?? Text(template.Props.GetValueOrDefault("liquid_material"));
            if (percent > 0 && string.IsNullOrEmpty(name))
            {
                throw Fail("no_liquid_material", index, $"liquid at {percent}% names no material and {template.Id} holds none");
            }
            props["liquid_amount"] = JsonValue.Create(Share(capacity, percent));
            props["liquid_material"] = JsonValue.Create(percent == 0 ? "" : name);
        }
        if (overrides.ContainsKey("condition"))
        {
            var condition = Text(overrides["condition"]);
            if (condition is not ("intact" or "damaged"))
            {
                throw Fail("invalid_form", index, "condition must be intact or damaged");
            }
            // Intact is the template's whole integrity, damaged half of it: 100 and 50 for a thing with no max.
            var whole = template.MaxIntegrity ?? Limits.MaxIntegrity;
            result["integrity"] = JsonValue.Create(condition == "intact" ? whole : whole / 2);
        }
        if (overrides.ContainsKey("hunger_pct"))
        {
            PresetInteger(template, "hunger", index, "hunger_pct");
            props["hunger"] = JsonValue.Create(WholePercent(overrides["hunger_pct"], index, "hunger_pct"));
        }
        if (overrides.ContainsKey("portions_pct"))
        {
            var percent = WholePercent(overrides["portions_pct"], index, "portions_pct");
            props["portions"] = JsonValue.Create(Share(PresetInteger(template, "portions", index, "portions_pct"), percent));
        }
        if (props.Count > 0)
        {
            result["props"] = props;
        }
        return result;
    }

    // The first field or prop (props.name) of a scenario entry's overrides the architect may not write, or null. Run on the entry as
    // written, before the forms become the raw props they convert to.
    public static string? ArchitectWrites(JsonObject overrides)
    {
        foreach (var key in overrides.Select(pair => pair.Key))
        {
            if (!ArchitectFields.Contains(key) && key != "props")
            {
                return key;
            }
        }
        switch (overrides["props"])
        {
            case JsonObject props:
                foreach (var name in props.Select(pair => pair.Key))
                {
                    if (!ArchitectProps.Contains(name))
                    {
                        return $"props.{name}";
                    }
                }
                break;
            // An array's keys are its indexes, which no prop is named.
            case JsonArray { Count: > 0 }:
                return "props.0";
        }
        return null;
    }

    // The liquid form is an object of material and pct only. An empty array passes this check as it does in TypeScript, and then fails
    // for its missing pct.
    private static bool IsLiquidShape(JsonNode liquid) => liquid switch
    {
        JsonObject liquidObject => liquidObject.All(pair => pair.Key is "material" or "pct"),
        JsonArray array => array.Count == 0,
        _ => false,
    };

    // A member of a form, read as its JavaScript would: an array has none, so its members are absent.
    private static JsonNode? Member(JsonNode form, string name) => form is JsonObject obj ? obj[name] : null;

    private static long WholePercent(JsonNode? value, int index, string form)
    {
        if (SafeInt(value) is not { } whole || whole < 0 || whole > 100)
        {
            throw Fail("invalid_form", index, $"{form} must be a whole number from 0 to 100");
        }
        return whole;
    }

    private static long PresetInteger(Template template, string prop, int index, string form)
    {
        if (SafeInt(template.Props.GetValueOrDefault(prop)) is not { } value)
        {
            throw Fail("form_not_applicable", index, $"{form} needs a template that declares {prop}, and {template.Id} does not");
        }
        return value;
    }

    private static WorldError Fail(string code, int index, string what) =>
        new(code, $"Scenario entry {index}: {what}");
}
