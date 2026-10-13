using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Whether a beat's condition holds on the snapshot now.
public static partial class Beats
{

    // Whether a well-formed condition holds (src/engine/beats.ts `holds`).
    public static bool Holds(JsonNode condition, Snapshot snapshot)
    {
        var obj = (JsonObject)condition;
        if (obj.ContainsKey("all"))
        {
            return ((JsonArray)obj["all"]!).All(single => SingleHolds(single!, snapshot));
        }
        return SingleHolds(obj, snapshot);
    }

    private static bool SingleHolds(JsonNode node, Snapshot snapshot)
    {
        var obj = (JsonObject)node;
        if (obj.ContainsKey("in"))
        {
            // A room that is not there holds nothing, so asking after it needs no check of its own.
            return snapshot.Entities.TryGetValue(TextOf(obj["entity"])!, out var subject) && subject.Location == TextOf(obj["in"]);
        }
        if (obj.ContainsKey("room"))
        {
            var room = TextOf(obj["room"])!;
            return snapshot.Entities.ContainsKey(room) && Occupied(snapshot, room) == BoolOf(obj["occupied"]);
        }
        if (!snapshot.Entities.TryGetValue(TextOf(obj["entity"])!, out var entity)
            || !entity.Props.TryGetValue(TextOf(obj["prop"])!, out var have))
        {
            return false;
        }
        var want = obj["value"];
        var op = TextOf(obj["op"])!;
        switch (op)
        {
            case "eq":
                return PropFields.SameValue(have, want);
            case "ne":
                return !PropFields.SameValue(have, want);
            default:
                return PropFields.Number(have) is { } left
                    && PropFields.Number(want) is { } right
                    && OrderOps.Holds(op, left, right);
        }
    }

    // Whether a live agent stands in the room: a destroyed body, a bled-out one and a severed part do not.
    private static bool Occupied(Snapshot snapshot, string room) =>
        snapshot.Entities.Values.Any(entity => entity.Location == room && Reach.IsAgent(snapshot, entity.Id));

}
