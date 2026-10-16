using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// Which thing a command's text names (src/engine/resolve.ts). An id, an `entity.part`, or a name or alias among
// what the actor can address. The two checks that need the senses and the control links (`addressable`, and
// what the actor controls or a panel it reaches serves) are passed in until those are ported; the author's
// path never calls them.
public static class Resolve
{
    public const string WorldAuthor = "world";

    public sealed record TargetAddress(string EntityId, string? Part, string Address);

    public abstract record TargetResolution;

    public sealed record Resolved(TargetAddress Target) : TargetResolution;

    public sealed record Unresolved : TargetResolution;

    public sealed record Ambiguous(IReadOnlyList<string> Candidates) : TargetResolution;

    // `Addressable(id)` is `addressable` in query.ts; `Controlled(id)` is true when the actor controls the entity
    // or a panel it reaches serves it (`controller` and `panelFor` in power.ts). A caller may pass its own (a stub
    // in a test); by default the engine's checks are used.
    public sealed record Access(Func<string, bool> Addressable, Func<string, bool> Controlled);

    private static Access EngineAccess(Snapshot snapshot, IReadOnlyDictionary<string, Template> registry, string actorId) =>
        new(
            id => Perception.Addressable(snapshot, registry, actorId, id),
            id => Power.Controller(snapshot, id) == actorId || Power.PanelFor(snapshot, id, actorId) is not null);

    // A door is known by its shape: anything with string `from` and `to` props joins the rooms they name.
    public static bool IsDoor(Entity? entity) =>
        entity is not null
        && entity.Props.Get(Prop.From) is not null
        && entity.Props.Get(Prop.To) is not null;

    // An abstract entity is a mark: nothing holds it, it holds nothing, and it is not addressable by an agent.
    public static bool IsAbstract(IReadOnlyDictionary<string, Template> registry, Entity? entity) =>
        entity is not null
        && registry.TryGetValue(entity.Template, out var template)
        && template.Props.Is(Prop.Abstract);

    // Scenery is perceived and named like anything, and acted on by nothing.
    public static bool IsScenery(IReadOnlyDictionary<string, Template> registry, Entity? entity) =>
        entity is not null
        && registry.TryGetValue(entity.Template, out var template)
        && template.Props.Is(Prop.Scenery);

    public static TargetResolution ResolveTarget(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string actorId,
        string text,
        Access? access = null)
    {
        var reach = access ?? EngineAccess(snapshot, registry, actorId);
        var skipAbstract = actorId != WorldAuthor;
        // The author names anything; an agent only what it could tell is there.
        bool Named(string id) =>
            !skipAbstract || (!IsAbstract(registry, Find(snapshot, id)) && reach.Addressable(id));

        if (snapshot.Entities.ContainsKey(text) && Named(text))
        {
            return Found(text, null);
        }

        var separator = text.LastIndexOf('.');
        if (separator > 0)
        {
            var entityId = text[..separator];
            var partName = text[(separator + 1)..];
            var entity = Find(snapshot, entityId);
            var state = entity is null || !Named(entityId)
                ? null
                : PartStates.Effective(TemplateOf(registry, entity), entity, partName);
            if (state is not null && state.Status != PartStatus.Detached)
            {
                return Found(entityId, partName);
            }
        }

        var actor = Find(snapshot, actorId);
        if (actor is null)
        {
            return new Unresolved();
        }

        var search = text.ToLowerInvariant();
        var matches = snapshot.Entities.Keys
            .Order(StringComparer.Ordinal)
            .Where(id =>
            {
                var entity = snapshot.Entities[id];
                // What the actor controls is named from wherever the actor is.
                if (!(InViewOf(entity, actor.Location) || reach.Controlled(id)))
                {
                    return false;
                }
                return (entity.Name.ToLowerInvariant() == search
                        || entity.Aliases.Any(alias => alias.ToLowerInvariant() == search))
                    && Named(id);
            })
            .ToList();

        return matches.Count switch
        {
            0 => new Unresolved(),
            1 => Found(matches[0], null),
            _ => new Ambiguous(matches),
        };
    }

    // A door or a panel has no location: it stands in the boundary between the rooms it joins.
    private static bool InViewOf(Entity entity, string? location)
    {
        if (entity.Location == location)
        {
            return true;
        }
        return entity.Props.Get(Prop.From) is not null
            && entity.Props.Get(Prop.To) is not null
            && (entity.Props.Get(Prop.From) == location || entity.Props.Get(Prop.To) == location);
    }

    private static TargetResolution Found(string entityId, string? part) =>
        new Resolved(new TargetAddress(entityId, part, part is null ? entityId : $"{entityId}.{part}"));

    private static Entity? Find(Snapshot snapshot, string id) =>
        snapshot.Entities.TryGetValue(id, out var entity) ? entity : null;

    private static Template? TemplateOf(IReadOnlyDictionary<string, Template> registry, Entity entity) =>
        registry.TryGetValue(entity.Template, out var template) ? template : null;
}
