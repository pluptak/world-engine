using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Part state is sparse (src/engine/parts.ts): a part at its template default (intact, at max_integrity) is
// not stored. An absent entry reads as that default, so every state has one stored form, and a part set back
// to its default leaves the record.
public static class PartStates
{
    public static bool IsDefault(PartDecl decl, PartState state) =>
        state.Status == PartStatus.Intact && state.Integrity == decl.MaxIntegrity && state.Bound is not true;

    // The state of a declared part, stored or default; null for a part the template does not declare and the
    // entity does not store.
    public static PartState? State(Template? template, Entity entity, string name)
    {
        if (entity.Parts.TryGetValue(name, out var stored))
        {
            return stored;
        }
        var decl = template?.Parts.FirstOrDefault(part => part.Name == name);
        return decl is null ? null : new PartState(decl.MaxIntegrity, PartStatus.Intact);
    }

    // A part as it stands on the body: its own state, unless an ancestor is detached or destroyed, in which case
    // it shares that status. A severed subtree stores only its root, so this is how a thumb on a severed hand
    // reads as detached.
    public static PartState? Effective(Template? template, Entity entity, string name)
    {
        var own = State(template, entity, name);
        if (own is null || own.Status is PartStatus.Detached or PartStatus.Destroyed)
        {
            return own;
        }
        var visited = new HashSet<string>(StringComparer.Ordinal) { name };
        var parent = template?.Parts.FirstOrDefault(part => part.Name == name)?.Parent;
        while (parent is not null && !visited.Contains(parent))
        {
            visited.Add(parent);
            var above = State(template, entity, parent);
            if (above is { Status: PartStatus.Detached or PartStatus.Destroyed } blocking)
            {
                return own with { Status = blocking.Status };
            }
            var current = parent;
            parent = template?.Parts.FirstOrDefault(part => part.Name == current)?.Parent;
        }
        return own;
    }

    // The record with each named part set to its state, an entry dropped where that is the default.
    public static Dictionary<string, PartState> With(
        Template template,
        IReadOnlyDictionary<string, PartState> parts,
        IReadOnlyDictionary<string, PartState> changes)
    {
        var next = new Dictionary<string, PartState>(parts, StringComparer.Ordinal);
        foreach (var name in changes.Keys.OrderBy(key => key, StringComparer.Ordinal))
        {
            var state = changes[name];
            var decl = template.Parts.FirstOrDefault(part => part.Name == name);
            if (decl is not null && IsDefault(decl, state))
            {
                next.Remove(name);
            }
            else
            {
                next[name] = state;
            }
        }
        return next;
    }
}
