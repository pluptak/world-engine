namespace WorldEngine.Core.Engine;

// The kinds of value a verb's arg takes, as the catalog names them.
public enum ArgKind
{
    Int,
    Enum,
    Token,
    Pos,
    Room,
    Address,
    AddressList,
    WorldEdit,
}

// One arg a verb takes: its kind, the values an `enum` allows, and whether it may be left out (true, or not said).
public sealed record ArgSpec(
    ArgKind Kind,
    IReadOnlyList<string>? Values = null,
    bool? Optional = null)
{
    public static ArgSpec OneOf(params IReadOnlyList<string> values) => new(ArgKind.Enum, values);
}
