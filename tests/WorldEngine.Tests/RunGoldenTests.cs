using WorldEngine.Core.Engine;

namespace WorldEngine.Tests;

// A run (src/engine/run.ts, docs/run.md) on the shared edit base world with a second agent: the run's state gate, the start,
// end, registration, pool play, steer and role edits, the finish rules, and the run's stored-state validation, each row's
// result compared with TypeScript's (Fixtures/run-golden.expected.json, from scratchpad/gen/run-golden.mjs).
public class RunGoldenTests
{
    private static IReadOnlyDictionary<string, Pipeline.VerbDecl> Verbs { get; } = new Dictionary<string, Pipeline.VerbDecl>
    {
        ["advance"] = TimeVerbs.Advance,
        ["edit"] = EditVerb.Edit,
        ["wait"] = WaitVerb.Wait,
    };

    [Fact]
    public void Run_rows_match_TypeScript()
    {
        GoldenRows.Check("run-golden.expected.json", Verbs);
    }
}
