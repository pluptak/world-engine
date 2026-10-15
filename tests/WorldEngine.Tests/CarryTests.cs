using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using WorldEngine.Store.Templates;

namespace WorldEngine.Tests;

// The grips, hands and carry verdicts of src/engine/carry.ts, on the rich dark world with the human e4 empty, holding
// one stone, and holding two, and on synthetic carrier limits no fixture world has. The expected answers come from
// the TypeScript module run on the same inputs (Fixtures/carry.expected.json, from scratchpad gen/carry.mjs).
public class CarryTests
{
    private const string Holder = "e4";

    private static IReadOnlyDictionary<string, Template> Registry { get; } =
        TemplateResolver.Resolve(TemplateDirectory.ReadDeclarations(Path.Combine(AppContext.BaseDirectory, "Fixtures", "templates")));

    private static JsonNode Golden { get; } =
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "carry.expected.json")))!;

    private static Snapshot Base { get; } = WorldJson.Read<Snapshot>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "rich-dark.snapshot.json")));

    // The same hand-holding the generator applies: the named items are put in the holder's parts.
    private static Snapshot WithHands(IReadOnlyDictionary<string, string> holds)
    {
        var entities = new Dictionary<string, Entity>(Base.Entities, StringComparer.Ordinal);
        foreach (var (id, part) in holds)
        {
            entities[id] = entities[id] with { ContainedIn = Holder, InPart = part, Support = null, Pos = null };
        }
        return Base with { Tick = 0, Entities = entities };
    }

    [Theory]
    [InlineData("empty")]
    [InlineData("one_hand")]
    [InlineData("both_hands")]
    public void Holding_and_claiming_match_TypeScript(string label)
    {
        var snapshot = label switch
        {
            "one_hand" => WithHands(new Dictionary<string, string> { ["e15"] = "hand_l" }),
            "both_hands" => WithHands(new Dictionary<string, string> { ["e15"] = "hand_l", ["e5"] = "hand_r" }),
            _ => WithHands(new Dictionary<string, string>()),
        };
        var expected = Golden["variants"]![label]!;
        var layout = Carry.HolderLayout(Registry, snapshot.Entities[Holder].Template);

        var result = new Dictionary<string, object?>
        {
            ["layout"] = new Dictionary<string, object?>
            {
                ["grips"] = layout.Grips,
                ["spaces"] = layout.Spaces.Select(space => new Dictionary<string, object?> { ["name"] = space.Name, ["inner"] = space.Inner }),
            },
            ["held_count"] = Carry.HeldCount(snapshot, Holder),
            ["held_in_parts"] = Carry.HeldInParts(snapshot, Registry, Holder)
                .Select(item => new Dictionary<string, object?> { ["id"] = item.Id, ["in_part"] = item.InPart, ["hands"] = item.Hands }),
            ["evictions"] = Carry.GripEvictions(snapshot, Registry, Holder),
            ["grips_packed"] = PackedJson(layout.Grips, snapshot),
            ["items"] = snapshot.Entities.Keys.Where(id => id != Holder).Order(StringComparer.Ordinal)
                .ToDictionary(id => id, id => ItemRow(snapshot, id), StringComparer.Ordinal),
        };

        if (GoldenUpdate.Enabled)
        {
            Golden["variants"]![label] = JsonNode.Parse(WorldJson.Write(result));
            GoldenUpdate.Write("carry.expected.json", Golden);
            return;
        }
        Meaning.Same(expected, WorldJson.Write(result), $"{label}: holding and claiming differ from TypeScript's");
    }

    [Fact]
    public void Synthetic_carry_verdicts_match_TypeScript()
    {
        var expected = Golden["synthetic"]!.AsArray();
        var shapes = new Dictionary<string, (string Template, Value.Map Props)>(StringComparer.Ordinal)
        {
            ["bottle_500g"] = ("bottle", Value.Map.Empty),
            ["book_two_handed"] = ("book", Value.Map.Empty.With("hands_required", 2L)),
            ["heavy_bars"] = ("bars", Value.Map.Empty),
        };
        var stone = Base.Entities["e15"];
        var index = 0;
        foreach (var label in new[] { "bottle_500g", "book_two_handed", "heavy_bars" })
        {
            var (template, props) = shapes[label];
            var item = stone with { Id = "x", Template = template, Props = props };
            foreach (var manipulation in new long[] { 0, 40, 60, 100 })
            {
                foreach (var mouth in new long[] { 0, 1 })
                {
                    foreach (var limit in new long?[] { null, 100, 2000 })
                    {
                        foreach (var otherHeld in new long[] { 0, 1 })
                        {
                            var row = expected[index++]!;
                            var caps = new Dictionary<string, long> { ["manipulation"] = manipulation, ["mouth_carry"] = mouth };
                            var carrierProps = limit is null
                                ? Value.Map.Empty
                                : Value.Map.Empty.With("hand_carry_limit_g", limit.Value).With("carry_limit_g", limit.Value);

                            var plain = Carry.Check(caps, carrierProps, item, Registry, otherHeld, Carry.Alternatives, 0);
                            var withHands = Carry.Check(caps, carrierProps, item, Registry, otherHeld, Carry.Alternatives, 80);

                            if (GoldenUpdate.Enabled)
                            {
                                row["carry"] = JsonNode.Parse(WorldJson.Write(VerdictJson(plain)));
                                row["carry_hands_mass_80"] = JsonNode.Parse(WorldJson.Write(VerdictJson(withHands)));
                                continue;
                            }
                            Meaning.Same(row["carry"], WorldJson.Write(VerdictJson(plain)), $"{label} row {index - 1}: the carry verdict differs from TypeScript's");
                            Meaning.Same(row["carry_hands_mass_80"], WorldJson.Write(VerdictJson(withHands)), $"{label} row {index - 1}: the carry verdict with hands' mass differs from TypeScript's");
                        }
                    }
                }
            }
        }
        Assert.Equal(expected.Count, index);
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("carry.expected.json", Golden);
        }
    }

    private static Dictionary<string, object?> ItemRow(Snapshot snapshot, string itemId)
    {
        var item = snapshot.Entities[itemId];
        var holder = snapshot.Entities[Holder];
        var caps = Capacities.All(snapshot, Registry, Holder);
        var lost = caps is null ? null : new Dictionary<string, long>(caps) { ["manipulation"] = 0 };
        var layout = Carry.HolderLayout(Registry, holder.Template);
        var claims = new Dictionary<string, object?> { ["free"] = ClaimJson(Carry.ClaimGrip(snapshot, Registry, Holder, item, null, itemId)) };
        foreach (var named in layout.Grips.Append("nope"))
        {
            claims[named] = ClaimJson(Carry.ClaimGrip(snapshot, Registry, Holder, item, named, itemId));
        }
        return new Dictionary<string, object?>
        {
            ["carry"] = VerdictJson(Carry.Check(caps, holder.Props, item, Registry, Carry.HeldCount(snapshot, Holder), Carry.Alternatives, Carry.HandsHeldMass(snapshot, Registry, Holder, itemId))),
            ["lost_carry"] = Carry.LostCarry(caps, lost, holder.Props, item, Registry, Carry.Alternatives),
            ["claims"] = claims,
        };
    }

    private static object? PackedJson(IReadOnlyList<string> grips, Snapshot snapshot)
    {
        var packed = Carry.PackGrips(grips, Carry.HeldInParts(snapshot, Registry, Holder));
        return packed is null ? null : packed.Order(StringComparer.Ordinal).ToList();
    }

    private static Dictionary<string, object?> VerdictJson(CarryVerdict verdict)
    {
        if (verdict.Ok)
        {
            return new Dictionary<string, object?> { ["ok"] = true };
        }
        var json = new Dictionary<string, object?> { ["ok"] = false, ["reason_code"] = verdict.ReasonCode };
        if (verdict.ReasonData is not null)
        {
            json["reason_data"] = verdict.ReasonData;
        }
        return json;
    }

    private static Dictionary<string, object?> ClaimJson(GripClaim claim) => claim switch
    {
        GripFound found => new Dictionary<string, object?> { ["part"] = found.Part },
        GripRefused refused => refused.ReasonData is null
            ? new Dictionary<string, object?> { ["reason_code"] = refused.ReasonCode }
            : new Dictionary<string, object?> { ["reason_code"] = refused.ReasonCode, ["reason_data"] = refused.ReasonData },
        _ => throw new InvalidOperationException("Unknown claim"),
    };
}
