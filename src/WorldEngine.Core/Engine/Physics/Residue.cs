namespace WorldEngine.Core.Engine;

// Residue left on a surface (src/engine/residue.ts `addResidue`): the surface's per-material amounts, with the additions
// merged in material order. A material a surface never held starts at nothing.
public static class Residue
{
    public static void Add(Working working, string surfaceId, IReadOnlyDictionary<string, long> additions, string eventId)
    {
        if (!working.Snapshot.Entities.TryGetValue(surfaceId, out var surface))
        {
            throw new InvalidOperationException($"Unknown residue surface {surfaceId}");
        }
        var residue = new Dictionary<string, long>(surface.Residue, StringComparer.Ordinal);
        foreach (var material in additions.Keys.Order(StringComparer.Ordinal))
        {
            residue[material] = residue.GetValueOrDefault(material) + additions[material];
        }
        working.SetResidue(surfaceId, residue, eventId);
    }
}
