namespace WorldEngine.Core.Engine;

// The capacities the engine reads by name. A template's parts may contribute any capacity, and a sense is read as the capacity of
// its own name (`Sense`), so a capacity stays a string.
public static class Capacity
{
    public const string Manipulation = "manipulation";
    public const string MouthCarry = "mouth_carry";
    public const string Moving = "moving";
    public const string Speech = "speech";
}
