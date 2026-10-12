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
}
