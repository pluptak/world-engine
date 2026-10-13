using WorldEngine.Core.Engine;

namespace WorldEngine.Tests;

// Authored beats (src/engine/beats.ts) on the shipped templates: each row's result compared with TypeScript's. A beat that
// is already scheduled in a row's snapshot is run by a "command" row's advance (Fixtures/beat-golden.expected.json, from
// scratchpad/gen/beat-golden.mjs); the schedule edits and stop_before are the rows of beat-schedule-golden.expected.json. A
// "validate" row names the issues its schedule gets, in order.
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
        GoldenRows.Check("beat-golden.expected.json", Verbs);
    }

    [Fact]
    public void Beat_schedule_rows_match_TypeScript()
    {
        GoldenRows.Check("beat-schedule-golden.expected.json", Verbs);
    }
}
