using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Tests;

// The world author's edits (src/engine/verbs/edit.ts) on one small valid world: each result, whole, compared with TypeScript's
// (Fixtures/edit-golden.expected.json, from scratchpad/gen/edit-golden.mjs). The edits covered are the ported kinds; the
// refused ones name the code TypeScript gives, and the loud refusals of unported edits are not in the golden.
public class EditTests
{
    private static IReadOnlyDictionary<string, Template> Registry => TestTemplates.Registry;

    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["edit"] = EditVerb.Edit,
    };

    [Fact]
    public void Edit_results_match_TypeScript()
    {
        var rows = JsonNode.Parse(ReadFixture("edit-golden.expected.json"))!.AsArray();
        Assert.NotEmpty(rows);
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture("edit-base.snapshot.json"));

        foreach (var row in rows)
        {
            var name = row!["name"]!.GetValue<string>();
            var command = WorldJson.Read<Command>(row["command"]!.ToJsonString());

            var result = Pipeline.Apply(snapshot, Registry, Verbs, command);
            if (GoldenUpdate.Enabled)
            {
                row["result"] = JsonNode.Parse(WorldJson.Write(PipelineShape.Of(result)));
                continue;
            }

            Meaning.Same(row["result"], WorldJson.Write(PipelineShape.Of(result)), $"{name}: the result differs from TypeScript's");
        }
        if (GoldenUpdate.Enabled)
        {
            GoldenUpdate.Write("edit-golden.expected.json", rows);
        }
    }

    // An edit empties a field by naming it in `clear`; a list that names a field the edit also gives, a field it may not clear, or
    // is not a list of names is malformed.
    [Theory]
    [InlineData("""{"kind":"place","target":"e2","support":"e1","clear":["support"]}""")]
    [InlineData("""{"kind":"place","target":"e2","clear":["location"]}""")]
    [InlineData("""{"kind":"place","target":"e2","clear":"pos"}""")]
    [InlineData("""{"kind":"spawn","template":"stone","overrides":{"clear":["name"]}}""")]
    public void A_malformed_clear_is_invalid_args(string edit)
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture("edit-base.snapshot.json"));
        var command = new Command("c1", "world", "edit", Args: Value.Map.Empty.With("edit", ValueJson.FromNode(JsonNode.Parse(edit))));

        var result = Pipeline.Apply(snapshot, Registry, Verbs, command);

        Assert.Equal(Status.Invalid, result.Status);
        Assert.Equal(Code.InvalidArgs, result.ReasonCode);
    }

    // An edit that holds a fraction is no edit the engine can hold, so the author's edit of it is refused as malformed.
    [Fact]
    public void An_edit_holding_a_fraction_is_invalid_args()
    {
        var snapshot = WorldJson.Read<Snapshot>(ReadFixture("edit-base.snapshot.json"));
        var edit = JsonNode.Parse("""{"kind":"spawn","template":"stone","overrides":{"residue":{"wine":1.5}}}""")!.AsObject();

        var result = Pipeline.Apply(snapshot, Registry, Verbs, Submission.EditCommand(edit, "c1"));

        Assert.Equal(Status.Invalid, result.Status);
        Assert.Equal(Code.InvalidArgs, result.ReasonCode);
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
