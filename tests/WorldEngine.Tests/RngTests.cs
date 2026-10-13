using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;

namespace WorldEngine.Tests;

// The dice's outputs as src/engine/rng.ts produces them (Fixtures/rng.json, from node).
public class RngTests
{
    private static JsonNode Golden =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "rng.json")))!;

    [Fact]
    public void Each_seed_gives_the_TypeScript_sequence_of_values_and_states()
    {
        Assert.NotEmpty(Golden["steps"]!.AsArray());
        foreach (var seed in Golden["steps"]!.AsArray())
        {
            var state = (uint)seed!["seed"]!.GetValue<long>();
            foreach (var expected in seed["values"]!.AsArray())
            {
                var (value, next) = Rng.Next(state);

                Assert.Equal(expected!["state"]!.GetValue<long>(), next);
                Assert.Equal(expected["value"]!.GetValue<double>(), value);
                state = next;
            }
        }
    }

    [Fact]
    public void Round_order_is_the_TypeScript_permutation_for_each_state_and_tick()
    {
        Assert.NotEmpty(Golden["order"]!.AsArray());
        foreach (var case_ in Golden["order"]!.AsArray())
        {
            var state = (uint)case_!["state"]!.GetValue<long>();
            var tick = case_["tick"]!.GetValue<long>();
            var expected = case_["order"]!.AsArray().Select(node => node!.GetValue<int>()).ToList();

            Assert.Equal(expected, Rng.RoundOrder(state, tick, Enumerable.Range(0, 8).ToList()));
        }
    }

    [Fact]
    public void A_round_order_is_a_permutation_that_reads_without_advancing_the_dice()
    {
        var items = Enumerable.Range(0, 8).ToList();

        var first = Rng.RoundOrder(42u, 7, items);
        var second = Rng.RoundOrder(42u, 7, items);

        Assert.Equal(items, first.OrderBy(item => item).ToList());
        Assert.Equal(first, second);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(4294967295, true)]
    [InlineData(4294967296, false)]
    [InlineData(-1, false)]
    public void A_state_is_a_whole_number_below_2_to_the_32(long value, bool expected) =>
        Assert.Equal(expected, Rng.IsState(value));
}
