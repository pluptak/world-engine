using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Store;

// The players' pending moves of a stored world (src/api.ts `storedPending`): `pending.json` beside the log, one entry per handle, written
// under the world's turn. A replay never reads it, and nothing in the world's state depends on it (`docs/roles.md`). An entry holds a
// handle's moves, one per body, or its idle mark, and the list is rewritten whole with the handle's entry replaced.
public sealed class StoredPending(string dir) : IPendingMoves
{
    // One handle's entry: its moves, or that it is idle. A list of entries, not a map by handle: a handle is any token, `__proto__`
    // included.
    private sealed record Entry(string Handle, IReadOnlyList<Command>? Moves = null, bool? Idle = null);

    private readonly string path = Path.Combine(dir, "pending.json");

    public IReadOnlyList<Command> Moves(string handle) => MovesOf(Read().FirstOrDefault(entry => entry.Handle == handle));

    public void Set(string handle, Command command) =>
        Update(handle, current => new Entry(handle, [.. MovesOf(current).Where(move => move.Actor != command.Actor).Append(command)]));

    public void SetIdle(string handle) => Update(handle, _ => new Entry(handle, Idle: true));

    public void Clear(string handle, string? body = null) =>
        Update(handle, current =>
        {
            if (body is null)
            {
                return null;
            }
            var moves = MovesOf(current).Where(move => move.Actor != body).ToList();
            return moves.Count == 0 ? null : new Entry(handle, moves);
        });

    public IReadOnlyList<string> Handles() =>
        [.. Read().Where(entry => MovesOf(entry).Count > 0).Select(entry => entry.Handle).Order(StringComparer.Ordinal)];

    public IReadOnlyList<string> Idlers() =>
        [.. Read().Where(entry => entry.Idle == true).Select(entry => entry.Handle).Order(StringComparer.Ordinal)];

    private static IReadOnlyList<Command> MovesOf(Entry? entry) => entry?.Moves ?? [];

    private List<Entry> Read() => File.Exists(path) ? WorldJson.Read<List<Entry>>(WorldIO.ReadAllText(path)) : [];

    // Rewrites one handle's entry under the world's turn: `change` sees the entry as it is then, and returns the one to keep, or null to
    // keep none.
    private void Update(string handle, Func<Entry?, Entry?> change)
    {
        WorldLock.With(dir, () =>
        {
            var all = Read();
            var next = change(all.FirstOrDefault(entry => entry.Handle == handle));
            var rest = all.Where(other => other.Handle != handle);
            WorldWriter.AtomicWrite(path, WorldWriter.Canonical(next is null ? rest.ToList() : rest.Append(next).ToList()));
            return true;
        });
    }
}
