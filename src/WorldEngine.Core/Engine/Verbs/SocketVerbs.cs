using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The socket verbs (`docs/sockets.md`): a severed part filled again, by its own severed limb or by an
// entity made to fit it. The body is the target and the part is `args.part`, which must name a part of
// the body's template; `install` takes the item in `args.item`. Installing reverses severing, as
// `AttackVerb.DetachPart` spawns one out of it.
public static class SocketVerbs
{
    public static Pipeline.VerbDecl Install { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: InstallPreconditions,
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: InstallTransition);

    public static Pipeline.VerbDecl Extract { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: ExtractPreconditions,
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: ExtractTransition);

    private sealed record Socket(Entity Body, Template Template, string Part);

    // The body the command names and the part its args name: a part address is no body, and an unknown
    // part is no arg. An address of a detached part does not resolve (`Resolve`), so a stump is named
    // by its body.
    private static (Socket? Socket, Pipeline.Refusal? Failure) Common(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return (null, Pipeline.Invalid(Code.MissingTarget));
        }
        if (target.Part is not null)
        {
            return (null, Pipeline.Refused(Code.TargetAttached));
        }
        if (!context.Snapshot.Entities.TryGetValue(target.EntityId, out var body))
        {
            return (null, Pipeline.Invalid(Code.NoSuchEntity));
        }
        var template = context.Registry[body.Template];
        if (PartNamed(context) is not { } part || template.Parts.All(decl => decl.Name != part))
        {
            return (null, Pipeline.Invalid(Code.InvalidArgs));
        }
        return (new Socket(body, template, part), null);
    }

    private static Pipeline.Refusal? InstallPreconditions(Pipeline.CommandContext context)
    {
        var (socket, failure) = Common(context);
        if (failure is not null || socket is null)
        {
            return failure;
        }
        var snapshot = context.Snapshot;
        var actorId = context.Command.Actor;
        if (Address.OutOfReach(snapshot, actorId, socket.Body.Id) is { } reach)
        {
            return reach;
        }
        if (Address.AddressText(context, "item") is not { } itemText)
        {
            return Pipeline.Invalid(Code.InvalidArgs);
        }
        var addressed = Address.AddressEntity(context, itemText, Code.NotCarried);
        if (addressed.Failure is { } addressFailure)
        {
            return addressFailure;
        }
        var item = addressed.Entity!;
        if (item.ContainedIn != actorId)
        {
            return Pipeline.Refused(Code.NotCarried);
        }
        if (PartStates.State(socket.Template, socket.Body, socket.Part) is not { Status: PartStatus.Detached })
        {
            return Pipeline.Refused(Code.SocketOccupied);
        }
        if (!context.Registry.TryGetValue(item.Template, out var installable))
        {
            return Pipeline.Invalid(Code.UnknownTemplate);
        }
        var companion = $"{socket.Body.Template}.{socket.Part}";
        if (item.Template != companion && installable.Fits != companion)
        {
            return Pipeline.Refused(Code.DoesNotFit);
        }
        return Pipeline.RequirementRefusal(context);
    }

    private static Pipeline.Refusal? ExtractPreconditions(Pipeline.CommandContext context)
    {
        var (socket, failure) = Common(context);
        if (failure is not null || socket is null)
        {
            return failure;
        }
        if (Address.OutOfReach(context.Snapshot, context.Command.Actor, socket.Body.Id) is { } reach)
        {
            return reach;
        }
        if (PartStates.State(socket.Template, socket.Body, socket.Part)?.Installed is null)
        {
            return Pipeline.Refused(Code.NothingInstalled);
        }
        return Pipeline.RequirementRefusal(context);
    }

    // The item is absorbed into the body's part state: its subtree's states written from the item's parts,
    // as `DetachPart` copied them out, in reverse. The root reads intact at the item's integrity, and keeps
    // the installable's id unless the item is the companion itself.
    private static void InstallTransition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var bodyId = context.Target!.EntityId;
        var part = PartNamed(context)!;
        var itemText = Address.AddressText(context, "item")!;
        var current = context with { Snapshot = working.Snapshot };
        var address = Address.AddressEntity(current, itemText, Code.NotCarried);
        if (address.Entity is not { } item)
        {
            throw new InvalidOperationException("Install item changed after validation");
        }
        var body = working.Snapshot.Entities[bodyId];
        var template = current.Registry[body.Template];
        var installable = current.Registry[item.Template];
        var companion = $"{body.Template}.{part}";
        var installed = item.Template == companion ? null : item.Template;
        var itemParts = new Dictionary<string, PartState>(item.Parts, StringComparer.Ordinal);
        var itemIntegrity = item.Integrity;

        if (!Physical.RemoveEntity(working, current.Registry, item.Id, rootEventId))
        {
            throw new InvalidOperationException("Install item changed after validation");
        }
        var changes = new Dictionary<string, PartState>(StringComparer.Ordinal)
        {
            [part] = new PartState(itemIntegrity, PartStatus.Intact, null, installed),
        };
        foreach (var decl in installable.Parts)
        {
            changes[decl.Name] = itemParts.GetValueOrDefault(decl.Name) ?? new PartState(decl.MaxIntegrity, PartStatus.Intact);
        }
        var remaining = new Dictionary<string, PartState>(working.Snapshot.Entities[bodyId].Parts, StringComparer.Ordinal);
        foreach (var name in changes.Keys)
        {
            remaining.Remove(name);
        }
        working.SetParts(bodyId, PartStates.With(template, remaining, changes), rootEventId!);
        working.Emit(EventType.Installed, bodyId, Pipeline.Reason(("part", part), ("template", item.Template)), rootEventId);
    }

    // The installed subtree leaves the body as one entity of the installed template at the body's feet, with
    // the subtree's states; the root reads detached again, with no install. The spawn names its origin, as a
    // severed limb does, so the stump stays accounted for.
    private static void ExtractTransition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var bodyId = context.Target!.EntityId;
        var part = PartNamed(context)!;
        var body = working.Snapshot.Entities[bodyId];
        var template = context.Registry[body.Template];
        var root = PartStates.State(template, body, part);
        if (root?.Installed is not { } installedId || !context.Registry.TryGetValue(installedId, out var installedTemplate))
        {
            throw new InvalidOperationException("Extract socket changed after validation");
        }
        var states = new Dictionary<string, PartState>(StringComparer.Ordinal);
        foreach (var decl in installedTemplate.Parts)
        {
            states[decl.Name] = body.Parts.GetValueOrDefault(decl.Name) ?? new PartState(decl.MaxIntegrity, PartStatus.Intact);
        }
        var support = AttackVerb.FloorSupport(working.Snapshot, bodyId);
        var pos = Geometry.EffectivePos(working.Snapshot, bodyId);
        var spawned = working.SpawnUnder(
            context.Registry,
            installedId,
            new Spawn.Overrides(
                Location: support,
                Support: support,
                Pos: pos,
                Name: part,
                DetachedFrom: new DetachedFrom(bodyId, part),
                Integrity: root.Integrity),
            rootEventId,
            rootEventId);
        working.SetParts(
            spawned.Id,
            PartStates.With(installedTemplate, new Dictionary<string, PartState>(StringComparer.Ordinal), states),
            spawned.EventId);

        var remaining = new Dictionary<string, PartState>(body.Parts, StringComparer.Ordinal);
        remaining.Remove(part);
        foreach (var name in states.Keys)
        {
            remaining.Remove(name);
        }
        working.SetParts(
            bodyId,
            PartStates.With(template, remaining, new Dictionary<string, PartState>(StringComparer.Ordinal)
            {
                [part] = root with { Status = PartStatus.Detached, Installed = null },
            }),
            rootEventId!);
        working.Emit(EventType.Extracted, bodyId, Pipeline.Reason(("part", part), ("entity", spawned.Id)), rootEventId);
    }

    private static string? PartNamed(Pipeline.CommandContext context) =>
        context.Command.Args?.GetValueOrDefault("part").AsText();
}
