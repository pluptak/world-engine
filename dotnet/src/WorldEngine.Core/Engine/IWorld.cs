using System.Text.Json.Nodes;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// What an actor's view reads and sends through (src/api.ts `World`): the answers a world gives with the record it keeps. A view
// decides what of them its actor may see, so nothing here is shaped for an actor.
public interface IWorld
{
    Snapshot CurrentSnapshot();

    Entity? EntityOf(string id);

    JsonObject Observe(string observer, long? since = null, long? sinceTick = null);

    JsonObject? Inspect(string observer, string entity);

    Pipeline.Result Check(Command command);

    Options.Result OptionsFor(string actor, bool refused);

    Pipeline.Result Apply(Command command, long? basedOn = null, bool observe = false);

    // The players' pending moves, and the round with the players' roles on its moves, which only a handle reaches (`src/internal.ts`).
    IPendingMoves Pending { get; }

    Round.Outcome TakeRoundAs(IReadOnlyList<Command> moves);

    bool Heard(Snapshot before, Snapshot after, IReadOnlyList<WorldEvent> events, IReadOnlyList<string> observers);

    IReadOnlyList<ScheduledCause> Scheduled();

    // An edit sent under a role; the director's edit is the one that reaches this (`src/director-world.ts`).
    Pipeline.Result Edit(JsonObject edit, string? commandId = null, bool perceivers = false, By? by = null, long? basedOn = null);
}
