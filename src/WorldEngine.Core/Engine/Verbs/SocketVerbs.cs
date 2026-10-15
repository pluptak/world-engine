using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;
using static WorldEngine.Core.Json.Integers;

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
        if (!context.Registry.TryGetValue(body.Template, out var template))
        {
            return (null, Pipeline.Invalid(Code.UnknownTemplate));
        }
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

    // An installable that declares `outcome_ticks` makes the install an attempt: the item stays where it is and the cause waits
    // for its tick, when `RunOutcome` decides it. Any other is absorbed now.
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
        var installable = context.Registry[item.Template];
        if (installable.Props.Get(Prop.OutcomeTicks) is not { } ticks)
        {
            Absorb(working, context.Registry, bodyId, part, item, rootEventId!);
            return;
        }
        // A sure attempt draws nothing, so it needs no dice; any other needs a seed now, not at its tick.
        if (Odds(installable) < 100 && working.Snapshot.Rng is null)
        {
            throw new NoSeedError();
        }
        if (!TryAdd(working.Snapshot.Tick, ticks, out var due))
        {
            throw new InvalidOperationException($"An outcome {ticks} ticks on overflows the clock");
        }
        var scheduled = working.Emit(EventType.OutcomeScheduled, bodyId, Pipeline.Reason(("part", part), ("item", item.Id)), rootEventId);
        Schedule.Add(working, new OutcomeCause(due, bodyId, scheduled, part, item.Id, context.Command.Actor));
    }

    // An attempt falls due (`docs/sockets.md`). The body or the item gone, it was pruned with them. The item out of the body's
    // reach, or the stump filled meanwhile, it fails with that reason; else one roll under `success_pct` decides it, and a
    // failure costs the body `failure_damage`.
    public static void RunOutcome(Working working, IReadOnlyDictionary<string, Template> registry, OutcomeCause cause)
    {
        var snapshot = working.Snapshot;
        if (!snapshot.Entities.TryGetValue(cause.Entity, out var body) || !snapshot.Entities.TryGetValue(cause.Item, out var item))
        {
            return;
        }
        var template = registry[body.Template];
        var installable = registry[item.Template];
        var blocked = !Reach.InReach(snapshot, body.Id, item.Id) ? "out_of_reach"
            : PartStates.State(template, body, cause.Part) is not { Status: PartStatus.Detached } ? "socket_occupied"
            : null;
        var odds = Odds(installable);
        if (blocked is null && (odds >= 100 || working.Random() * 100 < odds))
        {
            var succeeded = working.Emit(EventType.OutcomeSucceeded, body.Id, Pipeline.Reason(("part", cause.Part), ("item", item.Id)), cause.CauseId);
            Absorb(working, registry, body.Id, cause.Part, item, succeeded);
            return;
        }
        var failed = working.Emit(
            EventType.OutcomeFailed,
            body.Id,
            Pipeline.Reason(("part", cause.Part), ("item", item.Id), ("reason", blocked ?? "roll")),
            cause.CauseId);
        if (blocked is null && installable.Props.Get(Prop.FailureDamage) is > 0 and var damage)
        {
            Harm.Apply(working, registry, body.Id, damage, failed);
        }
    }

    // The chance an attempt succeeds, in percent: `success_pct`, and nothing else.
    private static long Odds(Template installable) => installable.Props.Get(Prop.SuccessPct) ?? 100;

    // The item is absorbed into the body's part state: its subtree's states written from the item's parts,
    // as `DetachPart` copied them out, in reverse. The root reads intact at the item's integrity, and keeps
    // the installable's id unless the item is the companion itself.
    private static void Absorb(Working working, IReadOnlyDictionary<string, Template> registry, string bodyId, string part, Entity item, string causeId)
    {
        var body = working.Snapshot.Entities[bodyId];
        var template = registry[body.Template];
        var installable = registry[item.Template];
        var companion = $"{body.Template}.{part}";
        var installed = item.Template == companion ? null : item.Template;
        var itemParts = new Dictionary<string, PartState>(item.Parts, StringComparer.Ordinal);
        var itemIntegrity = item.Integrity;

        if (!Physical.RemoveEntity(working, registry, item.Id, causeId))
        {
            throw new InvalidOperationException("Install item changed after validation");
        }
        var changes = new Dictionary<string, PartState>(StringComparer.Ordinal)
        {
            [part] = new PartState(itemIntegrity, PartStatus.Intact, Installed: installed),
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
        working.SetParts(bodyId, PartStates.With(template, remaining, changes), causeId);
        working.Emit(EventType.Installed, bodyId, Pipeline.Reason(("part", part), ("template", item.Template)), causeId);
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
