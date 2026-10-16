namespace WorldEngine.Tests;

// How much of a large golden a run checks. A run checks a fixed sample (every Nth seed, row or case, the same ones every time);
// WORLD_ENGINE_DEEP=1 checks all of it, and a golden update always does, since it rewrites every row. Iterate on the sample, and
// run deep once before a commit.
//
//   WORLD_ENGINE_DEEP=1 dotnet test WorldEngine.slnx
internal static class Depth
{
    public static bool Deep => Environment.GetEnvironmentVariable("WORLD_ENGINE_DEEP") == "1" || GoldenUpdate.Enabled;

    // Whether the item at `index` is checked: every item when deep, else every `every`th.
    public static bool Takes(int index, int every) => Deep || index % every == 0;

    // A count when deep, a smaller one otherwise.
    public static int Count(int deep, int sampled) => Deep ? deep : sampled;
}
