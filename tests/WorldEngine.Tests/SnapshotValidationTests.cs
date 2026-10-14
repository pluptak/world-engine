using System.Text.Json;
using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The snapshot invariants (src/engine/validate.ts `validateSnapshot`): each variant of one valid world, with the issues
// TypeScript names for it in Fixtures/validate-golden.expected.json, compared by code and path in order. The messages
// are not compared. A variant that breaks no rule has no issues on either side.
public class SnapshotValidationTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    [Fact]
    public void Variants_report_the_issues_TypeScript_reports()
    {
        var rows = JsonNode.Parse(ReadFixture("validate-golden.expected.json"))!.AsArray();
        Assert.NotEmpty(rows);
        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var snapshot = WorldJson.Read<Snapshot>(row["snapshot"]!.ToJsonString());

            var expected = row["issues"]!.AsArray()
                .Select(issue => Describe(issue!["code"]!.GetValue<string>(), [.. issue["path"]!.AsArray().Select(part => part!.GetValue<string>())]))
                .ToList();
            var actual = SnapshotValidation.Validate(snapshot, Registry)
                .Select(issue => Describe(WorldJson.Name(issue.Code), issue.Path))
                .ToList();

            Assert.True(expected.SequenceEqual(actual), $"{name}: expected [{string.Join("; ", expected)}] but got [{string.Join("; ", actual)}]");
        }
    }

    // A deliberate deviation from TypeScript, which read such a cause and reported `unknown_cause_kind`: each kind is its own
    // record, so a stored cause of a kind with no record does not read at all.
    [Fact]
    public void A_cause_of_an_unknown_kind_does_not_read()
    {
        var rows = JsonNode.Parse(ReadFixture("validate-golden.expected.json"))!.AsArray();
        var snapshot = rows.Single(row => row!["name"]!.GetValue<string>() == "schedule_dangling")!["snapshot"]!.AsObject();
        snapshot["schedule"]![0]!["kind"] = "wrong";

        Assert.Throws<JsonException>(() => WorldJson.Read<Snapshot>(snapshot.ToJsonString()));
    }

    private static string Describe(string code, IReadOnlyList<string> path) => $"{code} {string.Join("/", path)}";

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
