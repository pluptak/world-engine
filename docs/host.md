# A reference host

`dotnet/tools/WorldEngine.Host` (`dotnet run --project dotnet/tools/WorldEngine.Host -- <scene.json> <plan.json> <dir>`) plays a run through the
CLI's JSON ops, as a real host would: it creates the world (`init`), registers each slot the plan
names (`director_edit`), starts the run, then plays rounds until the run ends or the plan's last
round. Every request goes through `CliRunner` as text, and every answer is read back as text.

**A round.** Each registered handle `player_observe`s, then its player answers; the host sends
each answer as `player_submit`, then `director_close_round`.

**Players.** A player is an async function of a `Turn` (`Round`, `Observation`). It answers a move, an array
of moves (one per body), or `"idle"`. The host waits for each player at most `timeout_ms` per
round, one deadline for the whole round. A player that is still answering at the deadline has
its answer dropped, not submitted later; a player that throws passes. Lateness is judged by when
the answer arrived, not by when the host looks, so a host that stalls drops nothing on time.

**The plan.** `{ timeout_ms, handles: { <handle>: { slot, moves } } }`. `slot` is the scene's
entity name (unique in the world). `moves[n]` is the answer for round `n`, one of the forms
above, or `{ "late": <answer> }`. A round a handle has no entry for is idle.

**The transcript.** `<dir>/transcript.jsonl`: one line per request, `{ request, response }`, in
order. The first line is the `init`.

**Not in it.** An LLM player (a player is any function that answers), a network server, and reads
of the scene's names beyond the plan's slots.
