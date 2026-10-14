using System.Text.Json.Serialization;

namespace WorldEngine.Core.Engine;

// The shape of a row of the engine's prop table (`Prop.Table`).

public enum PropType
{
    Boolean,
    Integer,
    String,
    Id,
}

public enum Tier
{
    Definition,
    State,
    Derived,
}

public sealed record PropField(
    PropType Type,
    Tier Tier,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyList<string>? Requires = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Min = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Max = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? Divides = null);
