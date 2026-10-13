namespace WorldEngine.Core.Engine;

// The ordering ops, shared by a process's `while` and a beat's condition (src/engine/compare.ts). Both callers check that both
// sides are numbers first, which is where the "an absent or non-numeric prop satisfies none of them" rule lives.
public static class OrderOps
{
    public static bool Holds(string op, double have, double want) => op switch
    {
        "lt" => have < want,
        "lte" => have <= want,
        "gt" => have > want,
        "gte" => have >= want,
        _ => throw new ArgumentException($"Not an ordering op: {op}", nameof(op)),
    };
}
