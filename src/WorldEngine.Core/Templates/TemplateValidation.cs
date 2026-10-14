using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Templates;

// The checks src/templates.ts makes on a declared or resolved set. Each message is the TypeScript one, with
// the source (a file name, or "<file> (inherited)") standing where the TypeScript names it.
public static class TemplateValidation
{
    private static readonly Prop<bool>[] SceneryForbids = [Prop.Agent, Prop.Surface, Prop.Container, Prop.Openable, Prop.LightSource, Prop.Barrier];

    // A declaration's own shape, before its parent is folded in (parseDecl). The typed reader catches wrong
    // JSON types; these are the rules a type cannot express.
    public static void CheckDeclaration(TemplateDecl decl, string source)
    {
        if (string.IsNullOrEmpty(decl.Id))
        {
            throw new FormatException($"{source} has an invalid id");
        }
        if (decl.Extends is not null && decl.Extends.Length == 0)
        {
            throw new FormatException($"{source}.extends must be a non-empty string");
        }
        if (decl.Extends is not null && decl.Lineage is not null)
        {
            throw new FormatException($"{source} declares both extends and lineage");
        }
        if (decl.Parts is not null && decl.PartOverrides is not null)
        {
            throw new FormatException($"{source} declares both parts and part_overrides");
        }
        if (decl.PartOverrides is not null)
        {
            foreach (var (name, over) in decl.PartOverrides)
            {
                if (over.Parent.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null or JsonValueKind.String))
                {
                    throw new FormatException($"{source}.part_overrides.{name}.parent must be a string or null");
                }
            }
        }
        if (decl.Parts is not null)
        {
            for (var index = 0; index < decl.Parts.Count; index += 1)
            {
                if (string.IsNullOrEmpty(decl.Parts[index].Name))
                {
                    throw new FormatException($"{source}.parts[{index}].name must be a non-empty string");
                }
            }
        }
        if (decl.Props is not null)
        {
            foreach (var (key, value) in decl.Props)
            {
                if (value is null or JsonObject or JsonArray)
                {
                    throw new FormatException($"{source}.props.{key} must be a primitive");
                }
            }
        }
        if (decl.MaxIntegrity is { } maxIntegrity && (maxIntegrity < 1 || maxIntegrity > Limits.MaxIntegrity))
        {
            throw new FormatException($"{source}.max_integrity must be an integer from 1 to {Limits.MaxIntegrity}");
        }
        if (decl.Fields is not null)
        {
            foreach (var (name, field) in decl.Fields)
            {
                var at = $"{source}.fields.{name}";
                if (Prop.Table.ContainsKey(name))
                {
                    throw new FormatException($"{at} is a prop the engine declares");
                }
                if (field.Tier is not ("definition" or "state"))
                {
                    throw new FormatException($"{at}.tier must be definition or state");
                }
                if (field.Type is not ("boolean" or "integer" or "string"))
                {
                    throw new FormatException($"{at}.type must be boolean, integer or string");
                }
            }
        }
    }

    public static void ValidateMaxIntegrity(Template template, string source)
    {
        if (template.MaxIntegrity is not null && template.Parts.Count > 0)
        {
            throw new FormatException($"{source} declares max_integrity and parts");
        }
    }

    public static void ValidateParts(Template template, string source)
    {
        var parts = new Dictionary<string, PartDecl>(StringComparer.Ordinal);
        foreach (var part in template.Parts)
        {
            if (!parts.TryAdd(part.Name, part))
            {
                throw new FormatException($"{source} has duplicate part {part.Name}");
            }
        }
        foreach (var part in template.Parts)
        {
            if (part.Parent is not null && !parts.ContainsKey(part.Parent))
            {
                throw new FormatException($"{source} part {part.Name} has missing parent {part.Parent}");
            }
        }

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        void Visit(string name)
        {
            if (visiting.Contains(name))
            {
                throw new FormatException($"{source} has a part cycle at {name}");
            }
            if (visited.Contains(name))
            {
                return;
            }
            visiting.Add(name);
            if (parts.TryGetValue(name, out var part) && part.Parent is not null)
            {
                Visit(part.Parent);
            }
            visiting.Remove(name);
            visited.Add(name);
        }
        foreach (var name in parts.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            Visit(name);
        }
    }

    // Every prop a template sets or its processes name is declared, by the engine's table or the template's
    // own `fields`, holds a value of its type, and comes with the props it requires.
    public static void ValidateProps(Template template, string source)
    {
        PropType? TypeOf(string name)
        {
            if (Prop.Table.TryGetValue(name, out var field))
            {
                return field.Type;
            }
            if (template.Fields is not null && template.Fields.TryGetValue(name, out var declared))
            {
                return ParseType(declared.Type);
            }
            return null;
        }

        // Scenery is acted on by nothing, so a prop that only matters to what acts on it is refused.
        if (template.Props.Is(Prop.Scenery))
        {
            foreach (var use in SceneryForbids)
            {
                if (template.Props.ContainsKey(use))
                {
                    throw new FormatException($"{source} props.scenery cannot go with {use}");
                }
            }
        }

        foreach (var (name, value) in template.Props)
        {
            var type = TypeOf(name);
            if (type is null)
            {
                throw new FormatException($"{source} props.{name} is not a declared prop");
            }
            if (!Prop.Matches(type.Value, value))
            {
                throw new FormatException($"{source} props.{name} must be {(type == PropType.Integer ? "an" : "a")} {TypeWord(type.Value)}");
            }
            var field = Prop.Table.GetValueOrDefault(name);
            var number = (value as Value.Int)?.Number;
            if (field?.Min is { } least && number is { } low && low < least)
            {
                throw new FormatException($"{source} props.{name} must be at least {least}");
            }
            if (field?.Max is { } most && number is { } high && high > most)
            {
                throw new FormatException($"{source} props.{name} must be at most {most}");
            }
            // JavaScript's `%` gives NaN for a zero divisor, which is not 0, so a zero is refused too.
            if (field?.Divides is { } whole && number is { } divisor && !(whole % divisor == 0))
            {
                throw new FormatException($"{source} props.{name} must divide {whole}");
            }
            foreach (var required in field?.Requires ?? Array.Empty<string>())
            {
                if (!template.Props.ContainsKey(required))
                {
                    throw new FormatException($"{source} props.{name} requires {required}");
                }
            }
        }

        foreach (var process in template.Processes ?? Array.Empty<ProcessDecl>())
        {
            var at = $"{source} processes.{process.Id}";
            var body = process.Body;
            var adjust = Walk(body, "effect", "adjust_prop", "prop")?.GetString()
                ?? throw new FormatException($"{at} has no effect on a prop");
            var named = new[]
            {
                Walk(body, "while", "prop")?.GetString(),
                adjust,
                Walk(body, "every_ticks_prop")?.GetString(),
                Walk(body, "then", "set_prop", "prop")?.GetString(),
            };
            foreach (var name in named)
            {
                if (name is not null && TypeOf(name) is null)
                {
                    throw new FormatException($"{at} names {name}, which is not a declared prop");
                }
            }
            if (TypeOf(adjust) != PropType.Integer)
            {
                throw new FormatException($"{at} adjusts {adjust}, which is not an integer prop");
            }
            if (Walk(body, "then", "set_prop") is { } setProp)
            {
                var prop = setProp.GetProperty("prop").GetString()!;
                var value = JsonNode.Parse(setProp.GetProperty("value").GetRawText());
                var type = TypeOf(prop)!.Value;
                if (!Prop.Matches(type, value))
                {
                    throw new FormatException($"{at} sets {prop} to a value that is not {TypeWord(type)}");
                }
            }
        }
    }

    // A product is spawned by its template id when a thing breaks or is used up, so one that names nothing,
    // or a room, is refused when the set is read.
    public static void AssertProducts(
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, string> sources)
    {
        foreach (var id in registry.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var template = registry[id];
            var lists = new (string Key, IReadOnlyList<Product> Products)[]
            {
                ("break_products", template.BreakProducts),
                ("spent_products", template.SpentProducts ?? Array.Empty<Product>()),
            };
            foreach (var (key, products) in lists)
            {
                foreach (var product in products)
                {
                    var at = $"{sources.GetValueOrDefault(id, id)} {key}";
                    if (!registry.ContainsKey(product.Template))
                    {
                        throw new FormatException($"{at} names unknown template {product.Template}");
                    }
                    if (product.Template == TemplateIds.Room)
                    {
                        throw new FormatException($"{at} names room, which cannot be set on anything");
                    }
                }
            }
        }
    }

    // A successor is an agent template the set holds, so one that names anything else is refused.
    public static void AssertSuccessors(IReadOnlyDictionary<string, Template> registry)
    {
        foreach (var id in registry.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            if (!registry[id].Props.TryGetValue(Prop.Successor, out var successor))
            {
                continue;
            }
            var named = successor is Value.Text text ? text.Content : CanonicalJson.Serialize(successor);
            var target = successor is Value.Text ? registry.GetValueOrDefault(named) : null;
            if (target is null || !target.Props.Is(Prop.Agent))
            {
                throw new FormatException($"{id} names successor {named}, which is not an agent template");
            }
        }
    }

    private static JsonValueKind? KindOf(JsonNode? node) => (node as JsonValue)?.GetValueKind();

    private static PropType? ParseType(string type) => type switch
    {
        "boolean" => PropType.Boolean,
        "integer" => PropType.Integer,
        "string" => PropType.String,
        _ => null,
    };

    private static string TypeWord(PropType type) => type switch
    {
        PropType.Boolean => "boolean",
        PropType.Integer => "integer",
        PropType.String => "string",
        _ => "id",
    };

    // The element at a path through a process body, or null where the path is absent.
    private static JsonElement? Walk(IReadOnlyDictionary<string, JsonElement> body, params string[] path)
    {
        if (!body.TryGetValue(path[0], out var current))
        {
            return null;
        }
        foreach (var key in path.Skip(1))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(key, out current))
            {
                return null;
            }
        }
        return current;
    }
}
