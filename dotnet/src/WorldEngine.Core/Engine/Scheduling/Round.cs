using System.Text.Json.Nodes;
using WorldEngine.Core.Model;
using WorldEngine.Core.Templates;

namespace WorldEngine.Core.Engine;

// A round's planning half (src/engine/round.ts): what a round refuses before it starts, what it refuses where it starts, and the
// order its moves are taken in. Every move is decided against the same world, and the order comes from the dice's own stream, so
// no caller picks it (`docs/rounds.md`). The clock moves once, when the round closes, which is not part of this.
public static class Round
{
    // The moves refused where the round starts, by index in the moves given (they take no part), and the indices of the moves the
    // round applies, in the order it applies them. A round refused or invalid before it starts has no moves in either.
    public sealed record Plan(
        Status Status,
        string? ReasonCode,
        IReadOnlyDictionary<int, Pipeline.Result> Early,
        IReadOnlyList<int> Order);

    // A move of a round is a verb that lasts one tick. A verb that lasts longer, or none, is not one; an undeclared verb is left
    // to be refused as unknown when the move is applied.
    public static bool IsRoundMove(IReadOnlyDictionary<string, Pipeline.VerbDecl> verbs, string verb) =>
        !verbs.TryGetValue(verb, out var declared) || declared.OneTick;

    public static Plan PlanRound(
        Snapshot snapshot,
        IReadOnlyDictionary<string, Template> registry,
        IReadOnlyDictionary<string, Pipeline.VerbDecl> verbs,
        IReadOnlyList<Command> moves)
    {
        var actors = moves.Select(move => move.Actor).ToList();
        if (actors.Distinct(StringComparer.Ordinal).Count() != actors.Count)
        {
            return new Plan(Status.Invalid, "duplicate_actor", new Dictionary<int, Pipeline.Result>(), []);
        }
        if (moves.Count >= 2 && snapshot.Rng is null)
        {
            return new Plan(Status.Refused, "no_seed", new Dictionary<int, Pipeline.Result>(), []);
        }
        var early = new Dictionary<int, Pipeline.Result>();
        var passing = new List<int>();
        for (var index = 0; index < moves.Count; index++)
        {
            var move = moves[index];
            if (!IsRoundMove(verbs, move.Verb))
            {
                early[index] = Pipeline.Unchanged(snapshot, move, Status.Invalid, reasonCode: "not_a_round_move");
                continue;
            }
            // Checked as a move of the round, which takes no time: the same verdict a move gets when it is applied.
            var result = Pipeline.Apply(snapshot, registry, verbs, move with { Round = true });
            if (result.Status == Status.Ok)
            {
                passing.Add(index);
            }
            else
            {
                early[index] = result;
            }
        }
        // Sorted by actor before the stream shuffles them, so the order does not depend on how the caller listed them.
        var byActor = passing.OrderBy(index => actors[index], StringComparer.Ordinal).ToList();
        return new Plan(Status.Ok, null, early, Rng.RoundOrder((uint)(snapshot.Rng ?? 0), snapshot.Tick, byActor));
    }

    // One round as taken: its status and, when it was taken, its number, each move's result in the order the moves were given, and the
    // closing tick. A round refused before it starts has no number and no results.
    public sealed record Outcome(
        Status Status,
        string? ReasonCode,
        long? Number,
        IReadOnlyList<Pipeline.Result> Results,
        Pipeline.Result? Closing);

    // Decides or logs one command of a round: with no `decided` result it is submitted; with one (a move the plan refused where the
    // round started) it is only logged.
    public delegate Pipeline.Result Decide(Command command, long? basedOn, RoundMark mark, Pipeline.Result? decided);

    // The round's moves in the order the plan gives, then its closing tick (src/api.ts `playRound`).
    public static Outcome Play(
        IReadOnlyList<Command> moves,
        Plan plan,
        long number,
        long start,
        Decide decide,
        By? closingBy = null)
    {
        var results = new Pipeline.Result[moves.Count];
        foreach (var (index, refused) in plan.Early)
        {
            results[index] = decide(moves[index] with { Round = true }, start, new RoundMark(number), refused);
        }
        for (var position = 0; position < plan.Order.Count; position++)
        {
            var index = plan.Order[position];
            results[index] = decide(moves[index] with { Round = true }, start, new RoundMark(number, Place: position + 1), null);
        }
        var closing = decide(
            new Command(
                $"round-{number}-close",
                Resolve.WorldAuthor,
                "advance",
                Args: new Dictionary<string, JsonNode?>(StringComparer.Ordinal) { ["ticks"] = JsonValue.Create(1L) },
                Round: true,
                By: closingBy),
            null,
            new RoundMark(number, Close: true),
            null);
        // The round is taken when its tick is: a close refused (a run that has ended) refuses the round too.
        return new Outcome(closing.Status, closing.ReasonCode, number, results, closing);
    }
}
