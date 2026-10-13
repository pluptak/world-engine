namespace WorldEngine.Core.Json;

// Whole numbers as the engine holds them: a .NET `long`. A JSON number read as a double is whole when it has no fraction and fits a long.
public static class Integers
{
    private const double LongLimit = 9_223_372_036_854_775_808.0; // 2^63, exact as a double

    public static bool IsWhole(double value) => Math.Floor(value) == value && value >= -LongLimit && value < LongLimit;

    // `left + right`, false when it would overflow a long.
    public static bool TryAdd(long left, long right, out long sum)
    {
        sum = unchecked(left + right);
        return ((left ^ sum) & (right ^ sum)) >= 0;
    }
}
