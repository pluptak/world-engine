using WorldEngine.Core.Json;
using WorldEngine.Core.Model;
namespace WorldEngine.Tests;

// The shape rules for a scheduled beat against TypeScript's (Fixtures/beat-shapes-golden.expected.json, from
// tools/golden-gen/beat-shapes-golden.ts): about a hundred `schedule_beat` edits, well formed and malformed in every way the shape rules
// tell apart (conditions, repeats, followers, actions, ids and ticks), then beats of each condition form left to run through an advance.
public class BeatShapesGoldenTests
{
    [Fact]
    public void Beat_shapes_and_runs_match_TypeScript() =>
        MemoryGoldenTests.Replay("beat-shapes-golden.expected.json", TestTemplates.RepoRegistry);
}
