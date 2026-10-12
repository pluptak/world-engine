namespace WorldEngine.Core.Engine;

// The world's dice (src/engine/rng.ts): a 32-bit state in the snapshot, so a roll is a function of the world
// and nothing else. mulberry32, written out here so no dependency decides what a replay means. The
// arithmetic is all mod 2^32, which is what unsigned 32-bit operations give.
public static class Rng
{
    public const long Modulus = 4_294_967_296;

    // Whether a value can be the state: a whole number from 0 to 2^32 - 1.
    public static bool IsState(long value) => value >= 0 && value < Modulus;

    // One step: a number in [0, 1) and the state after it.
    public static (double Value, uint State) Next(uint state)
    {
        unchecked
        {
            var next = state + 0x6D2B79F5u;
            var t = next;
            t = (t ^ (t >> 15)) * (t | 1u);
            t ^= t + (t ^ (t >> 7)) * (t | 61u);
            return ((t ^ (t >> 14)) / (double)Modulus, next);
        }
    }

    // The order a round takes its moves in: a permutation drawn from a stream of its own, started from the dice's
    // state and the tick. It reads the dice and never advances them.
    public static List<T> RoundOrder<T>(uint state, long tick, IReadOnlyList<T> items)
    {
        uint stream;
        unchecked
        {
            stream = state ^ (uint)(tick + 1) * 0x9E3779B9u;
        }
        var order = items.ToList();
        for (var i = order.Count - 1; i > 0; i -= 1)
        {
            var (value, next) = Next(stream);
            stream = next;
            var j = (int)Math.Floor(value * (i + 1));
            (order[i], order[j]) = (order[j], order[i]);
        }
        return order;
    }
}

// Thrown by a roll in a world with no seed; the pipeline turns it into a refusal.
public sealed class NoSeedException : Exception
{
    public NoSeedException()
        : base("The world has no seed to roll with")
    {
    }
}
