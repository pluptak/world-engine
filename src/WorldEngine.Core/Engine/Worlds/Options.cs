using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// What an actor can try now (src/options.ts `listOptions`): each verb dry-run against each thing the actor could name, and with
// the arg sets a verb suggests. A verb that needs args no list holds is named in `needs_args` and judged only once given some.
// A destroyed body, or anything that is no agent, has no options. Nothing is written: `dry` judges each command against the snapshot.
public static class Options
{
    // A command an actor could issue now, to be sent as it is: the verb, its target, and the args a verb that needs some suggested.
    public sealed record ReadyOption(
        string Verb,
        string? Target = null,
        Value.Map? Args = null);

    public sealed record BlockedOption(
        string Verb,
        string? Target,
        Value.Map? Args,
        string ReasonCode);

    public sealed record Result(
        string Actor,
        long Version,
        IReadOnlyList<ReadyOption> Ready,
        IReadOnlyList<string> NeedsArgs,
        IReadOnlyList<BlockedOption>? Blocked = null);

    // The options an actor has. `refused` also lists what each refused attempt was refused with.
    public static Result List(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        string actor,
        bool refused,
        Func<Command, Pipeline.Result> dry)
    {
        if (!snapshot.Entities.ContainsKey(actor))
        {
            throw new WorldError(Code.NoSuchEntity, $"Unknown actor {actor}");
        }
        var ready = new List<ReadyOption>();
        var needsArgs = new List<string>();
        var blocked = new List<BlockedOption>();
        if (Reach.IsAgent(snapshot, actor))
        {
            // Computed once: what the actor could name does not depend on the verb.
            var targets = snapshot.Entities.Keys
                .Order(StringComparer.Ordinal)
                .Where(id => id != actor
                    && !Resolve.IsAbstract(registry, snapshot.Entities[id])
                    && !Resolve.IsScenery(registry, snapshot.Entities[id])
                    && Perception.Addressable(snapshot, registry, actor, id))
                .ToList();
            foreach (var verb in VerbRegistry.All.Keys.Order(StringComparer.Ordinal))
            {
                var declared = VerbRegistry.All[verb];
                if (declared.AuthorOnly)
                {
                    continue;
                }
                foreach (var target in declared.RequiresTarget ? targets.Select(id => (string?)id) : new string?[] { null })
                {
                    var command = new Command("options", actor, verb, Target: target);
                    var outcome = dry(command);
                    if (outcome.Status == Status.Ok)
                    {
                        ready.Add(new ReadyOption(verb, target));
                    }
                    else if (outcome.Status == Status.Invalid && outcome.ReasonCode == Code.InvalidArgs)
                    {
                        if (declared.Suggest is null || declared.FreeArgs)
                        {
                            if (!needsArgs.Contains(verb))
                            {
                                needsArgs.Add(verb);
                            }
                        }
                        if (declared.Suggest is { } suggest)
                        {
                            var context = new Pipeline.CommandContext(
                                snapshot,
                                registry,
                                command,
                                target is null ? null : new Resolve.TargetAddress(target, null, target),
                                declared.Requires ?? []);
                            foreach (var args in suggest(context, targets))
                            {
                                var tried = dry(command with { Args = args });
                                if (tried.Status == Status.Ok)
                                {
                                    ready.Add(new ReadyOption(verb, target, args));
                                }
                                else
                                {
                                    blocked.Add(new BlockedOption(verb, target, args, ReasonOf(tried)));
                                }
                            }
                        }
                    }
                    else
                    {
                        blocked.Add(new BlockedOption(verb, target, null, ReasonOf(outcome)));
                    }

                    // A verb that acts on parts is also tried at each part of the body that is still on it, by name order.
                    if (declared.AimsAtParts && target is not null)
                    {
                        var parts = (Projection.VisibleParts(snapshot, registry, actor, target) ?? [])
                            .Where(part => part.Status != PartStatus.Detached)
                            .Select(part => part.Name)
                            .Order(StringComparer.Ordinal);
                        foreach (var part in parts)
                        {
                            var address = $"{target}.{part}";
                            var tried = dry(command with { Target = address });
                            if (tried.Status == Status.Ok)
                            {
                                ready.Add(new ReadyOption(verb, address));
                            }
                            else
                            {
                                blocked.Add(new BlockedOption(verb, address, null, ReasonOf(tried)));
                            }
                        }
                    }
                }
            }
        }
        return new Result(
            actor,
            snapshot.Version,
            ready,
            needsArgs,
            refused ? blocked : null);
    }

    // The reason an attempt was refused with: its code, or its status where it has none.
    private static string ReasonOf(Pipeline.Result result) => Pipeline.ReasonName(result.ReasonCode, result.Status);
}
