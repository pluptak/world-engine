using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Templates;

// The shape of a template declaration as JSON, checked before it is read into a typed record (src/templates.ts `parseDecl` and what it
// calls). A typed reader fills a missing field with a default and rejects a wrong type with its own words; TypeScript refuses both with a
// message that names the field, and a template that is half there should be refused, not run with zeros. Each message is TypeScript's, with
// the source (a file name, or `templates.json#id`) standing where it names it. One departure: a number must be a whole number wherever
// TypeScript asks for a finite one, since the engine and the canonical form hold integers only.
public static class TemplateShape
{
    private static readonly string[] ProcessOps = ["eq", "ne", "lt", "lte", "gt", "gte"];

    public static void Check(JsonNode? value, string source)
    {
        if (value is not JsonObject obj)
        {
            throw new FormatException($"{source} must contain a template object");
        }
        if (!IsText(obj["id"]) || Text(obj["id"])!.Length == 0)
        {
            throw new FormatException($"{source} has an invalid id");
        }
        if (obj.ContainsKey("extends") && (!IsText(obj["extends"]) || Text(obj["extends"])!.Length == 0))
        {
            throw new FormatException($"{source}.extends must be a non-empty string");
        }

        if (obj.ContainsKey("size_cm"))
        {
            if (obj["size_cm"] is not JsonObject size)
            {
                throw new FormatException($"{source}.size_cm must be an object");
            }
            foreach (var dimension in new[] { "w", "d", "h" })
            {
                AssertNumber(size[dimension], $"{source}.size_cm.{dimension}");
            }
        }
        if (obj.ContainsKey("mass_g"))
        {
            AssertNumber(obj["mass_g"], $"{source}.mass_g");
        }
        if (obj.ContainsKey("parts"))
        {
            if (obj["parts"] is not JsonArray parts)
            {
                throw new FormatException($"{source}.parts must be an array");
            }
            for (var index = 0; index < parts.Count; index++)
            {
                var label = $"{source}.parts[{index}]";
                if (parts[index] is not JsonObject part)
                {
                    throw new FormatException($"{label} must be an object");
                }
                if (!IsText(part["name"]) || Text(part["name"])!.Length == 0)
                {
                    throw new FormatException($"{label}.name must be a non-empty string");
                }
                if (!part.ContainsKey("parent") || (part["parent"] is not null && !IsText(part["parent"])))
                {
                    throw new FormatException($"{label}.parent must be a string or null");
                }
                AssertNumericRecord(part["contributes"], $"{label}.contributes");
                if (!IsBool(part["detachable"]))
                {
                    throw new FormatException($"{label}.detachable must be a boolean");
                }
                AssertNumber(part["max_integrity"], $"{label}.max_integrity");
                CheckHolds(part, label);
            }
        }
        if (obj.ContainsKey("part_overrides"))
        {
            if (obj.ContainsKey("parts"))
            {
                throw new FormatException($"{source} declares both parts and part_overrides");
            }
            CheckPartOverrides(obj["part_overrides"], $"{source}.part_overrides");
        }
        if (obj.ContainsKey("props"))
        {
            if (obj["props"] is not JsonObject props)
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
            AssertNumericRecord(obj["break_residue"], $"{source}.break_residue");
        }
        CheckProducts(obj, "spent_products", source, strict: true);
        if (obj.ContainsKey("spent_residue"))
        {
            AssertNumericRecord(obj["spent_residue"], $"{source}.spent_residue");
        }
        if (obj.ContainsKey("processes"))
        {
            CheckProcesses(obj["processes"], $"{source}.processes");
        }
        if (obj.ContainsKey("fields"))
        {
            CheckFields(obj["fields"], $"{source}.fields");
        }
        if (obj.ContainsKey("lineage"))
        {
            if (obj.ContainsKey("extends"))
            {
                throw new FormatException($"{source} declares both extends and lineage");
            }
            if (obj["lineage"] is not JsonArray lineage || lineage.Any(id => !IsText(id) || Text(id)!.Length == 0))
            {
                throw new FormatException($"{source}.lineage must be an array of template ids");
            }
        }
        if (obj.ContainsKey("catalog") && !IsBool(obj["catalog"]))
        {
            throw new FormatException($"{source}.catalog must be a boolean");
        }
        if (obj.ContainsKey("max_integrity"))
        {
            if (!IsNumber(obj["max_integrity"])
                || !Integers.IsWhole(Number(obj["max_integrity"]))
                || Number(obj["max_integrity"]) < 1
                || Number(obj["max_integrity"]) > Limits.MaxIntegrity)
            {
                throw new FormatException($"{source}.max_integrity must be an integer from 1 to {Limits.MaxIntegrity}");
            }
        }
    }

    private static void CheckProducts(JsonObject obj, string key, string source, bool strict)
    {
        if (!obj.ContainsKey(key))
        {
            return;
        }
        if (obj[key] is not JsonArray products)
        {
            throw new FormatException($"{source}.{key} must be an array");
        }
        for (var index = 0; index < products.Count; index++)
        {
            var label = $"{source}.{key}[{index}]";
            if (products[index] is not JsonObject product || !IsText(product["template"]))
            {
                throw new FormatException($"{label} must contain a template id");
            }
            if (strict)
            {
                AssertOnlyKeys(product, ["template", "count"], label);
            }
            AssertInteger(product["count"], $"{label}.count");
            if (Number(product["count"]) < 0)
            {
                throw new FormatException($"{label}.count must not be negative");
            }
        }
    }

    private static void CheckPartOverrides(JsonNode? value, string label)
    {
        if (value is not JsonObject overrides)
        {
            throw new FormatException($"{label} must be an object");
        }
        foreach (var (name, node) in overrides)
        {
            var at = $"{label}.{name}";
            if (node is not JsonObject part)
            {
                throw new FormatException($"{at} must be an object");
            }
            AssertOnlyKeys(part, ["parent", "contributes", "detachable", "max_integrity", "holds"], at);
            if (part.ContainsKey("parent") && part["parent"] is not null && !IsText(part["parent"]))
            {
                throw new FormatException($"{at}.parent must be a string or null");
            }
            if (part.ContainsKey("contributes"))
            {
                AssertNumericRecord(part["contributes"], $"{at}.contributes");
            }
            if (part.ContainsKey("detachable") && !IsBool(part["detachable"]))
            {
                throw new FormatException($"{at}.detachable must be a boolean");
            }
            if (part.ContainsKey("max_integrity"))
            {
                AssertNumber(part["max_integrity"], $"{at}.max_integrity");
            }
            CheckHolds(part, at);
        }
    }

    private static void CheckFields(JsonNode? value, string label)
    {
        if (value is not JsonObject fields)
        {
            throw new FormatException($"{label} must be an object");
        }
        foreach (var (name, node) in fields)
        {
            var at = $"{label}.{name}";
            if (PropFields.Table.ContainsKey(name))
            {
                throw new FormatException($"{at} is a prop the engine declares");
            }
            if (node is not JsonObject field)
            {
                throw new FormatException($"{at} must be an object");
            }
            AssertOnlyKeys(field, ["tier", "type"], at);
            if (Text(field["tier"]) is not ("definition" or "state"))
            {
                throw new FormatException($"{at}.tier must be definition or state");
            }
            if (Text(field["type"]) is not ("boolean" or "integer" or "string"))
            {
                throw new FormatException($"{at}.type must be boolean, integer or string");
            }
        }
    }

    private static void CheckHolds(JsonObject part, string label)
    {
        if (!part.ContainsKey("holds"))
        {
            return;
        }
        var holdsLabel = $"{label}.holds";
        if (part["holds"] is not JsonObject holds || Text(holds["kind"]) is not ("grip" or "space"))
        {
            throw new FormatException($"{holdsLabel} must declare kind \"grip\" or \"space\"");
        }
        if (Text(holds["kind"]) == "grip")
        {
            if (!holds.All(pair => pair.Key == "kind"))
            {
                throw new FormatException($"{holdsLabel} carries only its kind");
            }
            return;
        }
        foreach (var dimension in new[] { "inner_w_cm", "inner_d_cm", "inner_h_cm" })
        {
            AssertNumber(holds[dimension], $"{holdsLabel}.{dimension}");
        }
        if (!holds.All(pair => pair.Key == "kind" || pair.Key.StartsWith("inner_", StringComparison.Ordinal)))
        {
            throw new FormatException($"{holdsLabel} carries only its kind and inner dimensions");
        }
    }

    private static void CheckProcesses(JsonNode? value, string label)
    {
        if (value is not JsonArray entries)
        {
            throw new FormatException($"{label} must be an array");
        }
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < entries.Count; index++)
        {
            var at = $"{label}[{index}]";
            if (entries[index] is not JsonObject entry)
            {
                throw new FormatException($"{at} must be an object");
            }
            AssertOnlyKeys(entry, ["id", "every_ticks", "every_ticks_prop", "chance_pct", "while", "effect", "then"], at);
            if (!IsText(entry["id"]) || Text(entry["id"])!.Length == 0)
            {
                throw new FormatException($"{at}.id must be a non-empty string");
            }
            var id = Text(entry["id"])!;
            if (!seen.Add(id))
            {
                throw new FormatException($"{label} declares process {id} twice");
            }
            var named = $"{label}.{id}";
            AssertInteger(entry["every_ticks"], $"{named}.every_ticks");
            if (Number(entry["every_ticks"]) < 1)
            {
                throw new FormatException($"{named}.every_ticks must be at least 1");
            }
            var adjust = CheckEffect(entry["effect"], $"{named}.effect");
            if (Defined(entry, "every_ticks_prop") && (!IsText(entry["every_ticks_prop"]) || Text(entry["every_ticks_prop"])!.Length == 0))
            {
                throw new FormatException($"{named}.every_ticks_prop must be a non-empty string");
            }
            if (Defined(entry, "chance_pct"))
            {
                AssertInteger(entry["chance_pct"], $"{named}.chance_pct");
                if (Number(entry["chance_pct"]) < 1 || Number(entry["chance_pct"]) > 99)
                {
                    throw new FormatException($"{named}.chance_pct must be from 1 to 99");
                }
            }
            if (Defined(entry, "while"))
            {
                CheckWhile(entry["while"], $"{named}.while");
            }
            if (Defined(entry, "then"))
            {
                var by = Number(adjust["by"]);
                if ((by < 0 ? adjust["min"] : adjust["max"]) is null)
                {
                    throw new FormatException($"{named}.then needs the bound the process moves toward (min for a negative by, max for a positive)");
                }
                CheckThen(entry["then"], $"{named}.then");
            }
        }
    }

    private static void CheckWhile(JsonNode? clause, string label)
    {
        if (clause is not JsonObject obj)
        {
            throw new FormatException($"{label} must be an object");
        }
        AssertOnlyKeys(obj, ["prop", "op", "value"], label);
        if (!IsText(obj["prop"]) || Text(obj["prop"])!.Length == 0)
        {
            throw new FormatException($"{label}.prop must be a non-empty string");
        }
        var op = Text(obj["op"]);
        if (op is null || !ProcessOps.Contains(op))
        {
            throw new FormatException($"{label}.op must be one of {string.Join(", ", ProcessOps)}");
        }
        var wanted = obj["value"];
        if (!IsText(wanted) && !IsNumber(wanted) && !IsBool(wanted))
        {
            throw new FormatException($"{label}.value must be a primitive");
        }
        if (op is not ("eq" or "ne") && !IsNumber(wanted))
        {
            throw new FormatException($"{label}.value must be a number for {op}");
        }
    }

    private static void CheckThen(JsonNode? value, string label)
    {
        if (value is not JsonObject obj)
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
                if (!(IsBool(obj["remove"]) && obj["remove"]!.GetValue<bool>()))
                {
                    throw new FormatException($"{label}.remove must be true");
                }
                break;
            case "spent":
                if (!(IsBool(obj["spent"]) && obj["spent"]!.GetValue<bool>()))
                {
                    throw new FormatException($"{label}.spent must be true");
                }
                break;
            case "damage":
            {
                if (obj["damage"] is not JsonObject damage)
                {
                    throw new FormatException($"{label}.damage must be an object");
                }
                AssertOnlyKeys(damage, ["amount"], $"{label}.damage");
                AssertInteger(damage["amount"], $"{label}.damage.amount");
                if (Number(damage["amount"]) < 1)
                {
                    throw new FormatException($"{label}.damage.amount must be at least 1");
                }
                break;
            }
            default:
            {
                if (obj["set_prop"] is not JsonObject set)
                {
                    throw new FormatException($"{label}.set_prop must be an object");
                }
                AssertOnlyKeys(set, ["prop", "value"], $"{label}.set_prop");
                if (!IsText(set["prop"]) || Text(set["prop"])!.Length == 0)
                {
                    throw new FormatException($"{label}.set_prop.prop must be a non-empty string");
                }
                if (!IsText(set["value"]) && !IsNumber(set["value"]) && !IsBool(set["value"]))
                {
                    throw new FormatException($"{label}.set_prop.value must be a primitive");
                }
                break;
            }
        }
    }

    // The effect's `adjust_prop`, checked; returned so the caller can read the bound `then` needs.
    private static JsonObject CheckEffect(JsonNode? value, string label)
    {
        if (value is not JsonObject effect)
        {
            throw new FormatException($"{label} must be an object");
        }
        AssertOnlyKeys(effect, ["adjust_prop"], label);
        if (effect["adjust_prop"] is not JsonObject adjust)
        {
            throw new FormatException($"{label}.adjust_prop must be an object");
        }
        AssertOnlyKeys(adjust, ["prop", "by", "min", "max"], $"{label}.adjust_prop");
        if (!IsText(adjust["prop"]) || Text(adjust["prop"])!.Length == 0)
        {
            throw new FormatException($"{label}.adjust_prop.prop must be a non-empty string");
        }
        AssertInteger(adjust["by"], $"{label}.adjust_prop.by");
        if (Number(adjust["by"]) == 0)
        {
            throw new FormatException($"{label}.adjust_prop.by must not be 0");
        }
        foreach (var bound in new[] { "min", "max" })
        {
            if (Defined(adjust, bound))
            {
                AssertInteger(adjust[bound], $"{label}.adjust_prop.{bound}");
            }
        }
        if (Defined(adjust, "min") && Defined(adjust, "max") && Number(adjust["min"]) > Number(adjust["max"]))
        {
            throw new FormatException($"{label}.adjust_prop.min must not exceed max");
        }
        return adjust;
    }

    private static void AssertNumericRecord(JsonNode? value, string label)
    {
        if (value is not JsonObject record)
        {
            throw new FormatException($"{label} must be an object");
        }
        foreach (var (key, number) in record)
        {
            AssertNumber(number, $"{label}.{key}");
        }
    }

    private static void AssertOnlyKeys(JsonObject value, string[] allowed, string label)
    {
        var stray = value.Select(pair => pair.Key).FirstOrDefault(key => !allowed.Contains(key));
        if (stray is not null)
        {
            throw new FormatException($"{label} has unknown field {stray}");
        }
    }

    // A number the template holds: TypeScript asks for a finite one; here it must be whole too.
    private static void AssertNumber(JsonNode? value, string label)
    {
        if (!IsNumber(value))
        {
            throw new FormatException($"{label} must be a finite number");
        }
        if (!Integers.IsWhole(Number(value)))
        {
            throw new FormatException($"{label} must be an integer");
        }
    }

    private static void AssertInteger(JsonNode? value, string label)
    {
        if (!IsNumber(value) || !Integers.IsWhole(Number(value)))
        {
            throw new FormatException($"{label} must be an integer");
        }
    }

    // An absent key and one that is JSON `undefined` are the same in TypeScript; null is a value, and is refused where one is read.
    private static bool Defined(JsonObject obj, string key) => obj.ContainsKey(key);

    private static double Number(JsonNode? node) => node!.GetValue<double>();

    private static bool IsNumber(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.Number;

    private static bool IsText(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.String;

    private static bool IsBool(JsonNode? node) => node is JsonValue value && value.GetValueKind() is JsonValueKind.True or JsonValueKind.False;

    private static string? Text(JsonNode? node) => IsText(node) ? node!.GetValue<string>() : null;
}
