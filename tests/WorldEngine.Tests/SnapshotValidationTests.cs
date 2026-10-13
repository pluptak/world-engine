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
                .Select(issue => Describe(issue.Code, issue.Path))
                .ToList();

            Assert.True(expected.SequenceEqual(actual), $"{name}: expected [{string.Join("; ", expected)}] but got [{string.Join("; ", actual)}]");
        }
    }

    private static string Describe(string code, IReadOnlyList<string> path) => $"{code} {string.Join("/", path)}";

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
