using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// Authored beats (src/engine/beats.ts) on the shipped templates: each row's result compared with TypeScript's
// (Fixtures/beat-golden.expected.json, from scratchpad/gen/beat-golden.mjs). Each beat was scheduled through TypeScript's
// schedule_beat, so a "command" row advances time over it; a "validate" row names the issues its schedule gets, in order.
public class BeatGoldenTests
{
    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["advance"] = TimeVerbs.Advance,
        ["edit"] = EditVerb.Edit,
    };

    [Fact]
    public void Beat_rows_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("beat-golden.expected.json"))!.AsArray();

        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var snapshot = WorldJson.Read<Snapshot>(row["snapshot"]!.ToJsonString());
            switch (row["kind"]!.GetValue<string>())
            {
                case "command":
                    var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());
                    var result = Pipeline.Apply(snapshot, TestTemplates.RepoRegistry, Verbs, command);
                    Assert.True(
                        CanonicalJson.Serialize(row["result"]) == WorldJson.Write(PipelineShape.Of(result)),
                        $"{name}: the result differs from TypeScript's");
                    break;
                case "validate":
                    var issues = SnapshotValidation.Validate(snapshot, TestTemplates.RepoRegistry);
                    var expected = row["issues"]!.AsArray()
                        .Select(issue => (
                            Code: issue!["code"]!.GetValue<string>(),
                            Path: string.Join("/", issue["path"]!.AsArray().Select(part => part!.GetValue<string>())),
                            Message: issue["message"]!.GetValue<string>()))
                        .ToList();
                    Assert.Equal(expected, issues.Select(issue => (issue.Code, Path: string.Join("/", issue.Path), issue.Message)).ToList());
                    break;
                default:
                    throw new InvalidDataException($"{name}: unknown row kind");
            }
        }
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
