namespace WorldEngine.Core.Engine;

// The part of src/engine/forms.ts the catalog reads: a percentage of what a preset holds. The rest of that module, which turns
// a scenario's forms into props, comes with the scenario port.
public static class Forms
{
    // A percentage of what the preset holds, floored, except that one above 0 never comes to 0: a candle's 8 fuel at 10% is 1,
    // so it still lights.
    public static long Share(long whole, long percent)
    {
        var part = (long)Math.Floor((double)whole * percent / 100);
        return percent > 0 ? Math.Max(part, 1) : part;
    }
}
