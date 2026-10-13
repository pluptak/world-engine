namespace WorldEngine.Core.Json;

// The range of a JavaScript number that holds a whole number exactly (`Number.MAX_SAFE_INTEGER`). The TypeScript engine runs on
// JavaScript numbers and refuses a tick, a due tick or an amount past it (`Number.isSafeInteger`), so the port refuses the same
// values where a .NET `long` would go on.
public static class JsNumber
{
    public const long MaxSafeInteger = 9_007_199_254_740_991;

    // `Number.isSafeInteger` over a whole number already held as a `long`: within 2^53 - 1 in magnitude.
    public static bool IsSafeInteger(long value) => Math.Abs(value) <= MaxSafeInteger;

    // `Number.isSafeInteger` over any JSON number: whole, and within 2^53 - 1 in magnitude.
    public static bool IsSafeInteger(double value) => Math.Floor(value) == value && Math.Abs(value) <= MaxSafeInteger;
}
