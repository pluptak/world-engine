using WorldEngine.Core.Engine;

namespace WorldEngine.Tests;

// The fields of a pipeline result the goldens compare, in the shape TypeScript's results have.
public static class PipelineShape
{
    public static Dictionary<string, object?> Of(Pipeline.Result result)
    {
        var shape = new Dictionary<string, object?>
        {
            ["status"] = result.Status.ToString().ToLowerInvariant(),
            ["command_id"] = result.CommandId,
            ["resolved_target"] = result.ResolvedTarget,
            ["snapshot"] = result.Snapshot,
            ["deltas"] = result.Deltas,
            ["events"] = result.Events,
        };
        if (result.ReasonCode is not null)
        {
            shape["reason_code"] = result.ReasonCode;
        }
        return shape;
    }
}
