using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Tests;

// The rows of a golden fixture generated from TypeScript (Fixtures/*.expected.json). A "command" row runs its command through
// the pipeline with the verbs given and compares the result's shape; a "validate" row names the issues its snapshot gets, in
// order. Each golden test names its fixture and the verbs its commands use.
public static class GoldenRows
{
    public static void Check(string fixture, IReadOnlyDictionary<string, Pipeline.VerbDecl> verbs)
    {
        var rows = JsonNode.Parse(ReadFixture(fixture))!.AsArray();

        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var snapshot = WorldJson.Read<Snapshot>(row["snapshot"]!.ToJsonString());
            switch (row["kind"]!.GetValue<string>())
            {
                case "command":
                    var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());
                    var result = Pipeline.Apply(snapshot, TestTemplates.RepoRegistry, verbs, command);
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
