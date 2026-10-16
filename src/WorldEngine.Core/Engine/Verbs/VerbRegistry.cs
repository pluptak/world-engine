using WorldEngine.Core.Model;

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
        ["cut"] = SurgeryVerbs.Cut,
        ["staunch"] = SurgeryVerbs.Staunch,
        ["suture"] = SurgeryVerbs.Suture,
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
        ["install"] = SocketVerbs.Install,
        ["extract"] = SocketVerbs.Extract,
    };

    // One verb's declared shape, as the catalog lists it.
    public sealed record CatalogEntry(
        string Verb,
        bool RequiresTarget,
        IReadOnlyDictionary<string, ArgSpec> Args,
        VerbDuration Duration,
        IReadOnlyList<Pipeline.Requirement> Requires,
        IReadOnlyList<Carry.Alternative> CarryAlternatives,
        IReadOnlyList<AttackVerb.AttackMode> AttackModes,
        IReadOnlyList<Code> Refuses);

    // The catalog: every verb's declared shape, sorted by name.
    public static IReadOnlyList<CatalogEntry> Catalog() => [.. All.Keys
        .Order(StringComparer.Ordinal)
        .Select(name =>
        {
            var (decl, spec) = (All[name], VerbSpecs.ByVerb[name]);
            return new CatalogEntry(
                name,
                decl.RequiresTarget,
                spec.Args,
                decl.Duration ?? VerbDuration.OneTick,
                decl.Requires ?? [],
                spec.CarryAlternatives ?? [],
                spec.AttackModes ?? [],
                spec.Refuses);
        })];
}
