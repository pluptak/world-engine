using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// The surgery verbs (`docs/verbs-surgery.md`): a cut opens a part of a body without severing it. The body is the target and the
// part is `args.part`, which must name a part of the body's template. The cut bleeds the part (`Schedule.StartBleeding`).
public static class SurgeryVerbs
{
    public static Pipeline.VerbDecl Cut { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: Preconditions,
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: Transition);

    public static Pipeline.VerbDecl Staunch { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: StaunchPreconditions,
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: StaunchTransition);

    public static Pipeline.VerbDecl Suture { get; } = new(
        RequiresTarget: true,
        AuthorOnly: false,
        Preconditions: SuturePreconditions,
        OneTick: true,
        Requires: [new Pipeline.Requirement(Capacity.Manipulation, 50)],
        Transition: SutureTransition);

    private sealed record Socket(Entity Body, Template Template, string Part);

    // The body the command names and the part its args name: a part address is no body, and an unknown
    // part is no arg.
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

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var (socket, failure) = Common(context);
        if (failure is not null || socket is null)
        {
            return failure;
        }
        var snapshot = context.Snapshot;
        if (Address.OutOfReach(snapshot, context.Command.Actor, socket.Body.Id) is { } reach)
        {
            return reach;
        }
        if (!Carry.HeldInParts(snapshot, context.Registry, context.Command.Actor).Any(item => snapshot.Entities[item.Id].Props.Is(Prop.Cuts)))
        {
            return Pipeline.Refused(Code.NoCuttingTool);
        }
        var state = PartStates.Effective(socket.Template, socket.Body, socket.Part);
        if (state is null || state.Status is not (PartStatus.Intact or PartStatus.Damaged))
        {
            return Pipeline.Refused(Code.PartUnavailable);
        }
        if (PartStates.State(socket.Template, socket.Body, socket.Part)?.Incised is true)
        {
            return Pipeline.Refused(Code.AlreadyIncised);
        }
        return Pipeline.RequirementRefusal(context);
    }

    // The incision is the root `cut` event's, and the bleed it starts is caused by that event, naming the part.
    private static void Transition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var body = working.Snapshot.Entities[context.Target!.EntityId];
        var part = PartNamed(context)!;
        var template = context.Registry[body.Template];
        var state = PartStates.State(template, body, part)!;
        working.SetParts(
            body.Id,
            PartStates.With(template, body.Parts, new Dictionary<string, PartState>(StringComparer.Ordinal)
            {
                [part] = state with { Incised = true },
            }),
            rootEventId!);
        Schedule.StartBleeding(working, body.Id, rootEventId!, part);
    }

    private static Pipeline.Refusal? StaunchPreconditions(Pipeline.CommandContext context)
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
        var bleeding = (context.Snapshot.Schedule ?? []).OfType<BleedCause>()
            .Any(cause => cause.Entity == socket.Body.Id && cause.Part == socket.Part);
        if (!bleeding)
        {
            return Pipeline.Refused(Code.NotBleeding);
        }
        return Pipeline.RequirementRefusal(context);
    }

    private static Pipeline.Refusal? SuturePreconditions(Pipeline.CommandContext context)
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
        if (PartStates.State(socket.Template, socket.Body, socket.Part)?.Incised is not true)
        {
            return Pipeline.Refused(Code.NotIncised);
        }
        return Pipeline.RequirementRefusal(context);
    }

    // Every bleed of the part leaves the schedule; a bleed that names no part is never staunched. The
    // removal is the root `staunch` event's, through the schedule the world holds.
    private static void StaunchTransition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var bodyId = context.Target!.EntityId;
        var part = PartNamed(context)!;
        working.SetSchedule([.. (working.Snapshot.Schedule ?? [])
            .Where(cause => cause is not BleedCause bleed || bleed.Entity != bodyId || bleed.Part != part)]);
    }

    // The incision closes; any bleed runs on. An entry back at its default leaves the record.
    private static void SutureTransition(Working working, Pipeline.CommandContext context, string? rootEventId)
    {
        var body = working.Snapshot.Entities[context.Target!.EntityId];
        var part = PartNamed(context)!;
        var template = context.Registry[body.Template];
        var state = PartStates.State(template, body, part)!;
        working.SetParts(
            body.Id,
            PartStates.With(template, body.Parts, new Dictionary<string, PartState>(StringComparer.Ordinal)
            {
                [part] = state with { Incised = null },
            }),
            rootEventId!);
    }

    private static string? PartNamed(Pipeline.CommandContext context) =>
        context.Command.Args?.GetValueOrDefault("part").AsText();
}
