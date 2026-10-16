using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// Whether a thing fits in a space (src/engine/fit.ts): both sides' dimensions are compared largest with largest, and the
// first pair the item overflows is the misfit.
public static class Fit
{
    // The item's first dimension that overflows the space's matching one (0 when the space has none), or null when it fits.
    public static (double ItemCm, double SpaceCm)? Misfit(IReadOnlyList<double> item, IReadOnlyList<double> destination)
    {
        var itemDescending = item.OrderByDescending(value => value).ToList();
        var destinationDescending = destination.OrderByDescending(value => value).ToList();
        for (var index = 0; index < itemDescending.Count; index++)
        {
            var space = index < destinationDescending.Count ? destinationDescending[index] : 0;
            if (itemDescending[index] > space)
            {
                return (itemDescending[index], space);
            }
        }
        return null;
    }

    // The inside of a container, from its `inner_w_cm`, `inner_d_cm` and `inner_h_cm` props, or null when any is missing.
    public static double[]? InnerDimensions(IReadOnlyDictionary<string, Value> props)
    {
        var width = props.Get(Prop.InnerWCm);
        var depth = props.Get(Prop.InnerDCm);
        var height = props.Get(Prop.InnerHCm);
        return width is null || depth is null || height is null ? null : [width.Value, depth.Value, height.Value];
    }
}
