using WorldEngine.Core.Model;

namespace WorldEngine.Core.Engine;

// The players' pending moves (src/internal.ts `PendingStore`): a handle's moves, one per body it drives, held until their round closes,
// or its idle mark, which passes every round until the handle submits again. Held by the world, never in its state: no version and no
// log line until the round closes (`docs/roles.md`, `docs/rounds.md`).
public interface IPendingMoves
{
    // The handle's moves, in the order they were submitted.
    IReadOnlyList<Command> Moves(string handle);

    // A move for its actor's body, which replaces that body's move and any idle mark.
    void Set(string handle, Command command);

    // Idle: passes the rounds, and drops every move.
    void SetIdle(string handle);

    // Drops the move for one body, or else every move and any idle mark.
    void Clear(string handle, string? body = null);

    // The handles that hold a move.
    IReadOnlyList<string> Handles();

    // The handles that are idle.
    IReadOnlyList<string> Idlers();
}

// The pending store of a memory world: held in the world, and gone with it.
public sealed class MemoryPendingMoves : IPendingMoves
{
    private sealed record Entry(List<Command> Moves, bool Idle = false);

    private readonly Dictionary<string, Entry> held = new(StringComparer.Ordinal);

    public IReadOnlyList<Command> Moves(string handle) =>
        held.TryGetValue(handle, out var entry) ? entry.Moves : [];

    public void Set(string handle, Command command)
    {
        var moves = Moves(handle).Where(move => move.Actor != command.Actor).Append(command).ToList();
        held[handle] = new Entry(moves);
    }

    public void SetIdle(string handle) => held[handle] = new Entry([], Idle: true);

    public void Clear(string handle, string? body = null)
    {
        if (body is null)
        {
            held.Remove(handle);
            return;
        }
        var moves = Moves(handle).Where(move => move.Actor != body).ToList();
        if (moves.Count == 0)
        {
            held.Remove(handle);
        }
        else
        {
            held[handle] = new Entry(moves);
        }
    }

    public IReadOnlyList<string> Handles() =>
        [.. held.Where(pair => pair.Value.Moves.Count > 0).Select(pair => pair.Key).Order(StringComparer.Ordinal)];

    public IReadOnlyList<string> Idlers() =>
        [.. held.Where(pair => pair.Value.Idle).Select(pair => pair.Key).Order(StringComparer.Ordinal)];
}
