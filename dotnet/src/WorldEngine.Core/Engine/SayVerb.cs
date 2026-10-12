using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The say verb (src/engine/verbs/say.ts): an actor speaks a token the caller made up and keeps the text of. The engine
// stores the token and its volume on the speaker's event, and never interprets it, so no prose crosses the boundary
// (docs/speech.md). Saying changes no state; the event is the whole of it, and an addressee is named as a fact of the act.
public static class SayVerb
{
    public static Pipeline.VerbDecl Say { get; } = new(
        RequiresTarget: false,
        AuthorOnly: false,
        Preconditions: Preconditions,
        Duration: _ => 1,
        OneTick: true,
        FreeArgs: true,
        Requires: [new Pipeline.Requirement("speech", 50)],
        RootEvent: RootEvent);

    // `\z`, not `$`: a trailing newline is not part of a token.
    internal static readonly Regex Utterance = new(@"^[A-Za-z0-9_.:-]{1,64}\z", RegexOptions.CultureInvariant);

    private static readonly string[] Volumes = ["whisper", "normal", "shout"];

    private static Pipeline.Refusal? Preconditions(Pipeline.CommandContext context)
    {
        var args = context.Command.Args;
        var utterance = Text(args, "utterance");
        if (utterance is null || !Utterance.IsMatch(utterance) || VolumeOf(args) is null)
        {
            return new Pipeline.Refusal(Status.Invalid, "invalid_args");
        }
        return Pipeline.RequirementRefusal(context);
    }

    // The speaker's event carries the token, its volume (normal when none is named), and the addressee when there is one.
    private static (string Entity, IReadOnlyDictionary<string, JsonNode?> Data) RootEvent(Pipeline.CommandContext context)
    {
        var data = new Dictionary<string, JsonNode?>(StringComparer.Ordinal)
        {
            ["utterance"] = JsonValue.Create(Text(context.Command.Args, "utterance")),
            ["volume"] = JsonValue.Create(VolumeOf(context.Command.Args) ?? "normal"),
        };
        if (context.Target is { } target)
        {
            data["to"] = JsonValue.Create(target.EntityId);
        }
        return (context.Command.Actor, data);
    }

    // The volume the command names, normal when it names none; null when it names one the verb does not know.
    private static string? VolumeOf(IReadOnlyDictionary<string, JsonNode?>? args)
    {
        if (args is null || !args.TryGetValue("volume", out var node) || node is null)
        {
            return "normal";
        }
        return node is JsonValue json && json.TryGetValue(out string? volume) && Volumes.Contains(volume) ? volume : null;
    }

    // An argument that is a string, or null when it is absent or not one.
    private static string? Text(IReadOnlyDictionary<string, JsonNode?>? args, string key) =>
        args is not null && args.TryGetValue(key, out var value) && value is JsonValue json && json.TryGetValue(out string? text)
            ? text
            : null;
}
