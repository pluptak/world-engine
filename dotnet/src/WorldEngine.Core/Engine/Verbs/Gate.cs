using System.Text.Json.Nodes;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// A gate or door that shuts, by hand or by itself, first moves everything on its footprint just clear, as a placement
// (src/engine/verbs/gate.ts `pushOccupantsAside`): nothing is swept, and a thing may end up overlapping what stands there.
// Each `moved` is caused by the `closed`, and a moved thing uncovers what it hid, as every mover does.
public static class Gate
{
    public static void PushOccupantsAside(
        Working working,
        IReadOnlyDictionary<string, Template> registry,
        string gateId,
        string closedEvent)
    {
        foreach (var occupantId in Geometry.OccupantsIn(working.Snapshot, registry, gateId))
        {
            var destination = Geometry.PushAsideDestination(working.Snapshot, registry, gateId, occupantId);
            var movedEvent = working.Emit("moved", occupantId, new Dictionary<string, JsonNode?>(), closedEvent);
            working.SetPos(occupantId, destination, movedEvent);
            Concealment.RevealConcealed(working, occupantId, movedEvent);
        }
    }
}
