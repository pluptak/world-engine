using System.Text.Json.Serialization;

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

// One arg a verb takes: its kind, the values an `enum` allows, and whether it may be left out.
public sealed record ArgSpec(
    ArgKind Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Values = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool Optional = false)
{
    public static ArgSpec OneOf(params IReadOnlyList<string> values) => new(ArgKind.Enum, values);
}
