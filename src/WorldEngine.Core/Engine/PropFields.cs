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
    IReadOnlyList<string>? Requires = null,
    long? Min = null,
    long? Max = null,
    long? Divides = null);
