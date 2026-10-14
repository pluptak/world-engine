using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What the architect may say about a thing in a scenario instead of a raw quantity (src/engine/forms.ts): whole percentages of what the
// preset holds, and two named levels of condition. Each is converted once, here, to the one stored value (fuel, liquid_amount and
// liquid_material, integrity, hunger, portions), so a form is a second way to write a field and never a second stored field.
// Pure and integer. Works on the overrides as values, since the scenario is read that way.
public static class Forms
{
    public static readonly string[] FormKeys = ["fuel_pct", "liquid", "condition", "hunger_pct", "portions_pct"];

    private static readonly HashSet<string> ArchitectFields =
    [
        "name", "aliases", "traits", "location", "support", "contained_in", "in_part", "concealed_by", "pos", "clear",
        "fuel_pct", "liquid", "condition", "hunger_pct", "portions_pct",
    ];

    private static readonly HashSet<string> ArchitectProps =
        [
            Prop.Open, Prop.Locked, Prop.Burning, Prop.Lit, Prop.From, Prop.To, Prop.Opens, Prop.PoweredBy, Prop.ControlledBy,
            Prop.FacingDeg, Prop.Asleep, Prop.Unconscious, Prop.Blind, Prop.Deaf, Prop.Bound,
        ];

    // A percentage of what the preset holds, floored, except that one above 0 never comes to 0: a candle's 8 fuel at 10% is 1, so it
    // still lights.
    public static long Share(long whole, long percent)
    {
        var part = (long)Math.Floor((double)whole * percent / 100);
        return percent > 0 ? Math.Max(part, 1) : part;
    }

    public static bool HasForms(Value.Map overrides) => FormKeys.Any(overrides.ContainsKey);

    // The overrides with every form converted away. A scenario entry is checked by ArchitectWrites first, so no raw prop a form converts
    // to is beside it: one fact is written one way.
    public static Value.Map Apply(Template template, Value.Map overrides, int index)
    {
        var props = overrides.GetValueOrDefault("props") as Value.Map ?? Value.Map.Empty;
        var result = overrides.Only(key => !FormKeys.Contains(key));

        if (overrides.TryGetValue("fuel_pct", out var fuel))
        {
            var percent = WholePercent(fuel, index, "fuel_pct");
            props = props.With(Prop.Fuel, Share(PresetInteger(template, Prop.Fuel, index, "fuel_pct"), percent));
        }
        if (overrides.TryGetValue("liquid", out var liquidValue))
        {
            // An empty list passes the shape as it does in TypeScript, whose arrays have no members, and then fails for its missing pct.
            var liquid = liquidValue switch
            {
                Value.Map map when map.Keys.All(key => key is "material" or "pct") => map,
                Value.List { Items.Length: 0 } => Value.Map.Empty,
                _ => throw Fail(Code.InvalidForm, index, "liquid must be { material?, pct }"),
            };
            var percent = WholePercent(liquid.GetValueOrDefault("pct"), index, "liquid.pct");
            var material = liquid.GetValueOrDefault("material");
            if (material is not null && material.AsText() is not { Length: > 0 })
            {
                throw Fail(Code.InvalidForm, index, "liquid.material must be a non-empty string");
            }
            var capacity = PresetInteger(template, Prop.CapacityCm3, index, "liquid");
            var name = material.AsText() ?? template.Props.Get(Prop.LiquidMaterial);
            if (percent > 0 && string.IsNullOrEmpty(name))
            {
                throw Fail(Code.NoLiquidMaterial, index, $"liquid at {percent}% names no material and {template.Id} holds none");
            }
            props = props.With(Prop.LiquidAmount, Share(capacity, percent)).With(Prop.LiquidMaterial, percent == 0 ? "" : name!);
        }
        if (overrides.TryGetValue("condition", out var conditionValue))
        {
            var condition = conditionValue.AsText();
            if (condition is not ("intact" or "damaged"))
            {
                throw Fail(Code.InvalidForm, index, "condition must be intact or damaged");
            }
            // Intact is the template's whole integrity, damaged half of it: 100 and 50 for a thing with no max.
            var whole = template.MaxIntegrity ?? Limits.MaxIntegrity;
            result = result.With("integrity", condition == "intact" ? whole : whole / 2);
        }
        if (overrides.TryGetValue("hunger_pct", out var hunger))
        {
            PresetInteger(template, Prop.Hunger, index, "hunger_pct");
            props = props.With(Prop.Hunger, WholePercent(hunger, index, "hunger_pct"));
        }
        if (overrides.TryGetValue("portions_pct", out var portions))
        {
            var percent = WholePercent(portions, index, "portions_pct");
            props = props.With(Prop.Portions, Share(PresetInteger(template, Prop.Portions, index, "portions_pct"), percent));
        }
        return props.Count > 0 ? result.With("props", props) : result;
    }

    // The first field or prop (props.name) of a scenario entry's overrides the architect may not write, or null. Run on the entry as
    // written, before the forms become the raw props they convert to.
    public static string? ArchitectWrites(Value.Map overrides)
    {
        foreach (var key in overrides.Keys)
        {
            if (!ArchitectFields.Contains(key) && key != "props")
            {
                return key;
            }
        }
        switch (overrides.GetValueOrDefault("props"))
        {
            case Value.Map props:
                foreach (var name in props.Keys)
                {
                    if (!ArchitectProps.Contains(name))
                    {
                        return $"props.{name}";
                    }
                }
                break;
            // A list's keys are its indexes, which no prop is named.
            case Value.List { Items.Length: > 0 }:
                return "props.0";
        }
        return null;
    }

    private static long WholePercent(Value? value, int index, string form)
    {
        if (value.AsInt() is not { } whole || whole < 0 || whole > 100)
        {
            throw Fail(Code.InvalidForm, index, $"{form} must be a whole number from 0 to 100");
        }
        return whole;
    }

    private static long PresetInteger(Template template, Prop<long> prop, int index, string form)
    {
        if (template.Props.Get(prop) is not { } value)
        {
            throw Fail(Code.FormNotApplicable, index, $"{form} needs a template that declares {prop}, and {template.Id} does not");
        }
        return value;
    }

    private static WorldError Fail(Code code, int index, string what) =>
        new(code, $"Scenario entry {index}: {what}");
}
