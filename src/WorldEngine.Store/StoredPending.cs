using System.Text.Json.Nodes;
using WorldEngine.Core.Engine;
using WorldEngine.Core.Json;
using WorldEngine.Core.Model;

namespace WorldEngine.Store;

// The players' pending moves of a stored world (src/api.ts `storedPending`): `pending.json` beside the log, one entry per handle, written
// under the world's turn. A replay never reads it, and nothing in the world's state depends on it (`docs/roles.md`). An entry holds a
// handle's moves, one per body, or its idle mark, and the list is rewritten whole with the handle's entry replaced.
public sealed class StoredPending(string dir) : IPendingMoves
{
    private readonly string path = Path.Combine(dir, "pending.json");

    public IReadOnlyList<Command> Moves(string handle) => MovesOf(Read().FirstOrDefault(entry => Handle(entry) == handle));

    public void Set(string handle, Command command) =>
        Update(handle, current => new JsonObject
        {
            ["handle"] = handle,
            ["moves"] = Written(MovesOf(current).Where(move => move.Actor != command.Actor).Append(command)),
        });

    public void SetIdle(string handle) => Update(handle, _ => new JsonObject { ["handle"] = handle, ["idle"] = true });

    public void Clear(string handle, string? body = null) =>
        Update(handle, current =>
        {
            if (body is null)
            {
                return null;
            }
            var moves = MovesOf(current).Where(move => move.Actor != body).ToList();
            return moves.Count == 0 ? null : new JsonObject { ["handle"] = handle, ["moves"] = Written(moves) };
        });

    public IReadOnlyList<string> Handles() =>
        [.. Read().Where(entry => MovesOf(entry).Count > 0).Select(Handle).Order(StringComparer.Ordinal)];

    public IReadOnlyList<string> Idlers() =>
        [.. Read().Where(entry => entry["idle"] is JsonValue idle && idle.GetValue<bool>()).Select(Handle).Order(StringComparer.Ordinal)];

    private static string Handle(JsonObject entry) => entry["handle"]!.GetValue<string>();

    private static IReadOnlyList<Command> MovesOf(JsonObject? entry) =>
        entry?["moves"] is JsonArray moves
            ? moves.Select(move => WorldJson.Read<Command>(move!)).ToList()
            : [];

    private static JsonArray Written(IEnumerable<Command> moves) =>
        new([.. moves.Select(move => (JsonNode?)JsonNode.Parse(WorldJson.Write(move)))]);

    // A list, not an object: a handle is any token, `__proto__` included.
    private List<JsonObject> Read() =>
        File.Exists(path) && JsonNode.Parse(WorldIO.ReadAllText(path)) is JsonArray entries
            ? [.. entries.Select(entry => entry!.AsObject())]
            : [];

    // Rewrites one handle's entry under the world's turn: `change` sees the entry as it is then, and returns the one to keep, or null to
    // keep none.
    private void Update(string handle, Func<JsonObject?, JsonObject?> change)
    {
        WorldLock.With(dir, () =>
        {
            var all = Read();
            var next = change(all.FirstOrDefault(entry => Handle(entry) == handle));
            var rest = all.Where(other => Handle(other) != handle).Cast<JsonNode>();
            var kept = next is null ? rest : rest.Append(next);
            WorldWriter.AtomicWrite(path, WorldWriter.Canonical(new JsonArray([.. kept.Select(node => node?.DeepClone())])));
            return true;
        });
    }
}
