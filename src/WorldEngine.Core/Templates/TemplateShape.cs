using WorldEngine.Core.Engine;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Templates;

// The shape of a template declaration as a value, checked before it is read into a typed record (src/templates.ts `parseDecl` and what
// it calls). A typed reader fills a missing field with a default and rejects a wrong type with its own words; TypeScript refuses both with
// a message that names the field, and a template that is half there should be refused, not run with zeros. Each message is TypeScript's,
// with the source (a file name, or `templates.json#id`) standing where it names it. A value holds whole numbers only, so a number is an
// integer wherever TypeScript asks for a finite one, and a null field is an absent one.
public static class TemplateShape
{
    private static readonly string[] ProcessOps = ["eq", "ne", "lt", "lte", "gt", "gte"];

    public static void Check(Value? value, string source)
    {
        if (value is not Value.Map obj)
        {
            throw new FormatException($"{source} must contain a template object");
        }
        if (!IsText(obj.GetValueOrDefault("id")) || Text(obj.GetValueOrDefault("id"))!.Length == 0)
        {
            throw new FormatException($"{source} has an invalid id");
        }
        if (obj.ContainsKey("extends") && (!IsText(obj.GetValueOrDefault("extends")) || Text(obj.GetValueOrDefault("extends"))!.Length == 0))
        {
            throw new FormatException($"{source}.extends must be a non-empty string");
        }

        if (obj.ContainsKey("size_cm"))
        {
            if (obj.GetValueOrDefault("size_cm") is not Value.Map size)
            {
                throw new FormatException($"{source}.size_cm must be an object");
            }
            foreach (var dimension in new[] { "w", "d", "h" })
            {
                AssertNumber(size.GetValueOrDefault(dimension), $"{source}.size_cm.{dimension}");
            }
        }
        if (obj.ContainsKey("mass_g"))
        {
            AssertNumber(obj.GetValueOrDefault("mass_g"), $"{source}.mass_g");
        }
        if (obj.ContainsKey("parts"))
        {
            if (obj.GetValueOrDefault("parts") is not Value.List parts)
            {
                throw new FormatException($"{source}.parts must be an array");
            }
            for (var index = 0; index < parts.Items.Length; index++)
            {
                var label = $"{source}.parts[{index}]";
                if (parts.Items[index] is not Value.Map part)
                {
                    throw new FormatException($"{label} must be an object");
                }
                if (!IsText(part.GetValueOrDefault("name")) || Text(part.GetValueOrDefault("name"))!.Length == 0)
                {
                    throw new FormatException($"{label}.name must be a non-empty string");
                }
                // A root part has no parent: the field is absent (a null one is).
                if (part.GetValueOrDefault("parent") is not null && !IsText(part.GetValueOrDefault("parent")))
                {
                    throw new FormatException($"{label}.parent must be a string");
                }
                AssertNumericRecord(part.GetValueOrDefault("contributes"), $"{label}.contributes");
                if (!IsBool(part.GetValueOrDefault("detachable")))
                {
                    throw new FormatException($"{label}.detachable must be a boolean");
                }
                AssertNumber(part.GetValueOrDefault("max_integrity"), $"{label}.max_integrity");
                CheckHolds(part, label);
            }
        }
        if (obj.ContainsKey("part_overrides"))
        {
            if (obj.ContainsKey("parts"))
            {
                throw new FormatException($"{source} declares both parts and part_overrides");
            }
            CheckPartOverrides(obj.GetValueOrDefault("part_overrides"), $"{source}.part_overrides");
        }
        if (obj.ContainsKey("props"))
        {
            if (obj.GetValueOrDefault("props") is not Value.Map props)
            {
                throw new FormatException($"{source}.props must be an object");
            }
            foreach (var (key, prop) in props)
            {
                if (!IsText(prop) && !IsNumber(prop) && !IsBool(prop))
                {
                    throw new FormatException($"{source}.props.{key} must be a primitive");
                }
            }
        }
        CheckProducts(obj, "break_products", source, strict: false);
        if (obj.ContainsKey("break_residue"))
        {
            AssertNumericRecord(obj.GetValueOrDefault("break_residue"), $"{source}.break_residue");
        }
        CheckProducts(obj, "spent_products", source, strict: true);
        if (obj.ContainsKey("spent_residue"))
        {
            AssertNumericRecord(obj.GetValueOrDefault("spent_residue"), $"{source}.spent_residue");
        }
        if (obj.ContainsKey("processes"))
        {
            CheckProcesses(obj.GetValueOrDefault("processes"), $"{source}.processes");
        }
        if (obj.ContainsKey("fields"))
        {
            CheckFields(obj.GetValueOrDefault("fields"), $"{source}.fields");
        }
        if (obj.ContainsKey("lineage"))
        {
            if (obj.ContainsKey("extends"))
            {
                throw new FormatException($"{source} declares both extends and lineage");
            }
            if (obj.GetValueOrDefault("lineage") is not Value.List lineage || lineage.Items.Any(id => !IsText(id) || Text(id)!.Length == 0))
            {
                throw new FormatException($"{source}.lineage must be an array of template ids");
            }
        }
        if (obj.ContainsKey("catalog") && !IsBool(obj.GetValueOrDefault("catalog")))
        {
            throw new FormatException($"{source}.catalog must be a boolean");
        }
        if (obj.ContainsKey("max_integrity"))
        {
            if (!IsNumber(obj.GetValueOrDefault("max_integrity"))
                || Number(obj.GetValueOrDefault("max_integrity")) < 1
                || Number(obj.GetValueOrDefault("max_integrity")) > Limits.MaxIntegrity)
            {
                throw new FormatException($"{source}.max_integrity must be an integer from 1 to {Limits.MaxIntegrity}");
            }
        }
    }

    private static void CheckProducts(Value.Map obj, string key, string source, bool strict)
    {
        if (!obj.ContainsKey(key))
        {
            return;
        }
        if (obj.GetValueOrDefault(key) is not Value.List products)
        {
            throw new FormatException($"{source}.{key} must be an array");
        }
        for (var index = 0; index < products.Items.Length; index++)
        {
            var label = $"{source}.{key}[{index}]";
            if (products.Items[index] is not Value.Map product || !IsText(product.GetValueOrDefault("template")))
            {
                throw new FormatException($"{label} must contain a template id");
            }
            if (strict)
            {
                AssertOnlyKeys(product, ["template", "count"], label);
            }
            AssertInteger(product.GetValueOrDefault("count"), $"{label}.count");
            if (Number(product.GetValueOrDefault("count")) < 0)
            {
                throw new FormatException($"{label}.count must not be negative");
            }
        }
    }

    private static void CheckPartOverrides(Value? value, string label)
    {
        if (value is not Value.Map overrides)
        {
            throw new FormatException($"{label} must be an object");
        }
        foreach (var (name, node) in overrides)
        {
            var at = $"{label}.{name}";
            if (node is not Value.Map part)
            {
                throw new FormatException($"{at} must be an object");
            }
            AssertOnlyKeys(part, ["parent", "contributes", "detachable", "max_integrity", "holds"], at);
            // An empty parent moves the part to the root.
            if (part.ContainsKey("parent") && !IsText(part.GetValueOrDefault("parent")))
            {
                throw new FormatException($"{at}.parent must be a string");
            }
            if (part.ContainsKey("contributes"))
            {
                AssertNumericRecord(part.GetValueOrDefault("contributes"), $"{at}.contributes");
            }
            if (part.ContainsKey("detachable") && !IsBool(part.GetValueOrDefault("detachable")))
            {
                throw new FormatException($"{at}.detachable must be a boolean");
            }
            if (part.ContainsKey("max_integrity"))
            {
                AssertNumber(part.GetValueOrDefault("max_integrity"), $"{at}.max_integrity");
            }
            CheckHolds(part, at);
        }
    }

    private static void CheckFields(Value? value, string label)
    {
        if (value is not Value.Map fields)
        {
            throw new FormatException($"{label} must be an object");
        }
        foreach (var (name, node) in fields)
        {
            var at = $"{label}.{name}";
            if (Prop.Table.ContainsKey(name))
            {
                throw new FormatException($"{at} is a prop the engine declares");
            }
            if (node is not Value.Map field)
            {
                throw new FormatException($"{at} must be an object");
            }
            AssertOnlyKeys(field, ["tier", "type"], at);
            if (Text(field.GetValueOrDefault("tier")) is not ("definition" or "state"))
            {
                throw new FormatException($"{at}.tier must be definition or state");
            }
            if (Text(field.GetValueOrDefault("type")) is not ("boolean" or "integer" or "string"))
            {
                throw new FormatException($"{at}.type must be boolean, integer or string");
            }
        }
    }

    private static void CheckHolds(Value.Map part, string label)
    {
        if (!part.ContainsKey("holds"))
        {
            return;
        }
        var holdsLabel = $"{label}.holds";
        if (part.GetValueOrDefault("holds") is not Value.Map holds || Text(holds.GetValueOrDefault("kind")) is not ("grip" or "space"))
        {
            throw new FormatException($"{holdsLabel} must declare kind \"grip\" or \"space\"");
        }
        if (Text(holds.GetValueOrDefault("kind")) == "grip")
        {
            if (!holds.All(pair => pair.Key == "kind"))
            {
                throw new FormatException($"{holdsLabel} carries only its kind");
            }
            return;
        }
        foreach (var dimension in new[] { Prop.InnerWCm.Name, Prop.InnerDCm.Name, Prop.InnerHCm.Name })
        {
            AssertNumber(holds.GetValueOrDefault(dimension), $"{holdsLabel}.{dimension}");
        }
        if (!holds.All(pair => pair.Key == "kind" || pair.Key.StartsWith("inner_", StringComparison.Ordinal)))
        {
            throw new FormatException($"{holdsLabel} carries only its kind and inner dimensions");
        }
    }

    private static void CheckProcesses(Value? value, string label)
    {
        if (value is not Value.List entries)
        {
            throw new FormatException($"{label} must be an array");
        }
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < entries.Items.Length; index++)
        {
            var at = $"{label}[{index}]";
            if (entries.Items[index] is not Value.Map entry)
            {
                throw new FormatException($"{at} must be an object");
            }
            AssertOnlyKeys(entry, ["id", "every_ticks", "every_ticks_prop", "chance_pct", "while", "effect", "then"], at);
            if (!IsText(entry.GetValueOrDefault("id")) || Text(entry.GetValueOrDefault("id"))!.Length == 0)
            {
                throw new FormatException($"{at}.id must be a non-empty string");
            }
            var id = Text(entry.GetValueOrDefault("id"))!;
            if (!seen.Add(id))
            {
                throw new FormatException($"{label} declares process {id} twice");
            }
            var named = $"{label}.{id}";
            AssertInteger(entry.GetValueOrDefault("every_ticks"), $"{named}.every_ticks");
            if (Number(entry.GetValueOrDefault("every_ticks")) < 1)
            {
                throw new FormatException($"{named}.every_ticks must be at least 1");
            }
            var adjust = CheckEffect(entry.GetValueOrDefault("effect"), $"{named}.effect");
            if (Defined(entry, "every_ticks_prop") && (!IsText(entry.GetValueOrDefault("every_ticks_prop")) || Text(entry.GetValueOrDefault("every_ticks_prop"))!.Length == 0))
            {
                throw new FormatException($"{named}.every_ticks_prop must be a non-empty string");
            }
            if (Defined(entry, "chance_pct"))
            {
                AssertInteger(entry.GetValueOrDefault("chance_pct"), $"{named}.chance_pct");
                if (Number(entry.GetValueOrDefault("chance_pct")) < 1 || Number(entry.GetValueOrDefault("chance_pct")) > 99)
                {
                    throw new FormatException($"{named}.chance_pct must be from 1 to 99");
                }
            }
            if (Defined(entry, "while"))
            {
                CheckWhile(entry.GetValueOrDefault("while"), $"{named}.while");
            }
            if (Defined(entry, "then"))
            {
                var by = Number(adjust.GetValueOrDefault("by"));
                if ((by < 0 ? adjust.GetValueOrDefault("min") : adjust.GetValueOrDefault("max")) is null)
                {
                    throw new FormatException($"{named}.then needs the bound the process moves toward (min for a negative by, max for a positive)");
                }
                CheckThen(entry.GetValueOrDefault("then"), $"{named}.then");
            }
        }
    }

    private static void CheckWhile(Value? clause, string label)
    {
        if (clause is not Value.Map obj)
        {
            throw new FormatException($"{label} must be an object");
        }
        AssertOnlyKeys(obj, ["prop", "op", "value"], label);
        if (!IsText(obj.GetValueOrDefault("prop")) || Text(obj.GetValueOrDefault("prop"))!.Length == 0)
        {
            throw new FormatException($"{label}.prop must be a non-empty string");
        }
        var op = Text(obj.GetValueOrDefault("op"));
        if (op is null || !ProcessOps.Contains(op))
        {
            throw new FormatException($"{label}.op must be one of {string.Join(", ", ProcessOps)}");
        }
        var wanted = obj.GetValueOrDefault("value");
        if (!IsText(wanted) && !IsNumber(wanted) && !IsBool(wanted))
        {
            throw new FormatException($"{label}.value must be a primitive");
        }
        if (op is not ("eq" or "ne") && !IsNumber(wanted))
        {
            throw new FormatException($"{label}.value must be a number for {op}");
        }
    }

    private static void CheckThen(Value? value, string label)
    {
        if (value is not Value.Map obj)
        {
            throw new FormatException($"{label} must be an object");
        }
        var keys = obj.Select(pair => pair.Key).ToList();
        if (keys.Count != 1 || keys[0] is not ("set_prop" or "damage" or "remove" or "spent"))
        {
            throw new FormatException($"{label} must declare exactly one of set_prop, damage, remove or spent");
        }
        switch (keys[0])
        {
            case "remove":
                if (!(IsBool(obj.GetValueOrDefault("remove")) && obj.GetValueOrDefault("remove").IsTrue()))
                {
                    throw new FormatException($"{label}.remove must be true");
                }
                break;
            case "spent":
                if (!(IsBool(obj.GetValueOrDefault("spent")) && obj.GetValueOrDefault("spent").IsTrue()))
                {
                    throw new FormatException($"{label}.spent must be true");
                }
                break;
            case "damage":
            {
                if (obj.GetValueOrDefault("damage") is not Value.Map damage)
                {
                    throw new FormatException($"{label}.damage must be an object");
                }
                AssertOnlyKeys(damage, ["amount"], $"{label}.damage");
                AssertInteger(damage.GetValueOrDefault("amount"), $"{label}.damage.amount");
                if (Number(damage.GetValueOrDefault("amount")) < 1)
                {
                    throw new FormatException($"{label}.damage.amount must be at least 1");
                }
                break;
            }
            default:
            {
                if (obj.GetValueOrDefault("set_prop") is not Value.Map set)
                {
                    throw new FormatException($"{label}.set_prop must be an object");
                }
                AssertOnlyKeys(set, ["prop", "value"], $"{label}.set_prop");
                if (!IsText(set.GetValueOrDefault("prop")) || Text(set.GetValueOrDefault("prop"))!.Length == 0)
                {
                    throw new FormatException($"{label}.set_prop.prop must be a non-empty string");
                }
                if (!IsText(set.GetValueOrDefault("value")) && !IsNumber(set.GetValueOrDefault("value")) && !IsBool(set.GetValueOrDefault("value")))
                {
                    throw new FormatException($"{label}.set_prop.value must be a primitive");
                }
                break;
            }
        }
    }

    // The effect's `adjust_prop`, checked; returned so the caller can read the bound `then` needs.
    private static Value.Map CheckEffect(Value? value, string label)
    {
        if (value is not Value.Map effect)
        {
            throw new FormatException($"{label} must be an object");
        }
        AssertOnlyKeys(effect, ["adjust_prop"], label);
        if (effect.GetValueOrDefault("adjust_prop") is not Value.Map adjust)
        {
            throw new FormatException($"{label}.adjust_prop must be an object");
        }
        AssertOnlyKeys(adjust, ["prop", "by", "min", "max"], $"{label}.adjust_prop");
        if (!IsText(adjust.GetValueOrDefault("prop")) || Text(adjust.GetValueOrDefault("prop"))!.Length == 0)
        {
            throw new FormatException($"{label}.adjust_prop.prop must be a non-empty string");
        }
        AssertInteger(adjust.GetValueOrDefault("by"), $"{label}.adjust_prop.by");
        if (Number(adjust.GetValueOrDefault("by")) == 0)
        {
            throw new FormatException($"{label}.adjust_prop.by must not be 0");
        }
        foreach (var bound in new[] { "min", "max" })
        {
            if (Defined(adjust, bound))
            {
                AssertInteger(adjust.GetValueOrDefault(bound), $"{label}.adjust_prop.{bound}");
            }
        }
        if (Defined(adjust, "min") && Defined(adjust, "max") && Number(adjust.GetValueOrDefault("min")) > Number(adjust.GetValueOrDefault("max")))
        {
            throw new FormatException($"{label}.adjust_prop.min must not exceed max");
        }
        return adjust;
    }

    private static void AssertNumericRecord(Value? value, string label)
    {
        if (value is not Value.Map record)
        {
            throw new FormatException($"{label} must be an object");
        }
        foreach (var (key, number) in record)
        {
            AssertNumber(number, $"{label}.{key}");
        }
    }

    private static void AssertOnlyKeys(Value.Map value, string[] allowed, string label)
    {
        var stray = value.Select(pair => pair.Key).FirstOrDefault(key => !allowed.Contains(key));
        if (stray is not null)
        {
            throw new FormatException($"{label} has unknown field {stray}");
        }
    }

    // A number the template holds: TypeScript asks for a finite one, and says so.
    private static void AssertNumber(Value? value, string label)
    {
        if (!IsNumber(value))
        {
            throw new FormatException($"{label} must be a finite number");
        }
    }

    private static void AssertInteger(Value? value, string label)
    {
        if (!IsNumber(value))
        {
            throw new FormatException($"{label} must be an integer");
        }
    }

    private static bool Defined(Value.Map obj, string key) => obj.ContainsKey(key);

    private static long Number(Value? node) => node.AsInt()!.Value;

    private static bool IsNumber(Value? node) => node is Value.Int;

    private static bool IsText(Value? node) => node is Value.Text;

    private static bool IsBool(Value? node) => node is Value.Bool;

    private static string? Text(Value? node) => node.AsText();
}
