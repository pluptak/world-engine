using System.Text.Json.Nodes;

namespace WorldEngine.Core.Engine;

// Every verb the engine has (src/engine/verbs/index.ts `verbRegistry`), and the catalog of what each declares
// (`verbCatalog`). The catalog is derived from the declarations and the spec table, never kept beside them.
public static class VerbRegistry
{
    public static readonly IReadOnlyDictionary<string, Pipeline.VerbDecl> All = new Dictionary<string, Pipeline.VerbDecl>(StringComparer.Ordinal)
    {
        ["move"] = MoveVerb.Move,
        ["take"] = TakeVerb.Take,
        ["drop"] = DropVerb.Drop,
        ["put"] = PutVerb.Put,
        ["give"] = GiveVerb.Give,
        ["pour"] = PourVerb.Pour,
        ["consume"] = ConsumeVerb.Consume,
        ["search"] = SearchVerbs.Search,
        ["light"] = LightVerbs.Light,
        ["douse"] = LightVerbs.Douse,
        ["open"] = OpenVerbs.Open,
        ["close"] = OpenVerbs.Close,
        ["lock"] = OpenVerbs.Lock,
        ["unlock"] = OpenVerbs.Unlock,
        ["switch_on"] = SwitchVerbs.SwitchOn,
        ["switch_off"] = SwitchVerbs.SwitchOff,
        ["push"] = PushVerbs.Push,
        ["pull"] = PushVerbs.Pull,
        ["attack"] = AttackVerb.Attack,
        ["say"] = SayVerb.Say,
        ["wait"] = WaitVerb.Wait,
        ["advance"] = TimeVerbs.Advance,
        ["edit"] = EditVerb.Edit,
    };

    // The catalog: every verb's declared shape, sorted by name, as the JSON the catalog returns.
    public static JsonArray Catalog() => new(All.Keys
        .Order(StringComparer.Ordinal)
        .Select(name => (JsonNode?)Entry(name, All[name]))
        .ToArray());

    private static JsonObject Entry(string name, Pipeline.VerbDecl decl)
    {
        var spec = VerbSpecs.ByVerb[name];
        return new JsonObject
        {
            ["verb"] = name,
            ["requires_target"] = decl.RequiresTarget,
            ["args"] = JsonNode.Parse(spec.Args),
            ["duration"] = JsonNode.Parse(spec.Duration),
            ["requires"] = new JsonArray((decl.Requires ?? [])
                .Select(requirement => (JsonNode?)new JsonObject
                {
                    ["capacity"] = requirement.Capacity,
                    ["at_least"] = requirement.AtLeast,
                })
                .ToArray()),
            ["carry_alternatives"] = JsonNode.Parse(spec.CarryAlternatives),
            ["attack_modes"] = JsonNode.Parse(spec.AttackModes),
            ["refuses"] = new JsonArray(spec.Refuses.Select(code => (JsonNode?)code).ToArray()),
        };
    }
}
