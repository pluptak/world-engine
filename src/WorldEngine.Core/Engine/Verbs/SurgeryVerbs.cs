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

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var target = context.Target;
        if (target is null)
        {
            return Pipeline.Invalid(Code.MissingTarget);
        }
        if (target.Part is not null)
        {
            return Pipeline.Refused(Code.TargetAttached);
        }
        var snapshot = context.Snapshot;
        if (!snapshot.Entities.TryGetValue(target.EntityId, out var body))
        {
            return Pipeline.Invalid(Code.NoSuchEntity);
        }
        var template = context.Registry[body.Template];
        if (PartNamed(context) is not { } part || template.Parts.All(decl => decl.Name != part))
        {
            return Pipeline.Invalid(Code.InvalidArgs);
        }
        if (Address.OutOfReach(snapshot, context.Command.Actor, body.Id) is { } reach)
        {
            return reach;
        }
        if (!Carry.HeldInParts(snapshot, context.Command.Actor).Any(item => snapshot.Entities[item.Id].Props.Is(Prop.Cuts)))
        {
            return Pipeline.Refused(Code.NoCuttingTool);
        }
        var state = PartStates.Effective(template, body, part);
        if (state is null || state.Status is not (PartStatus.Intact or PartStatus.Damaged))
        {
            return Pipeline.Refused(Code.PartUnavailable);
        }
        if (PartStates.State(template, body, part)?.Incised is true)
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

    private static string? PartNamed(Pipeline.CommandContext context) =>
        context.Command.Args?.GetValueOrDefault("part").AsText();
}
