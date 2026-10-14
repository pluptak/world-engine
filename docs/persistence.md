# Commands and persistence

The CLI is a JSON adapter over a world: one request on stdin, one call, one response. The request
is read as a value and checked by the contract (`Checks`), and a failure becomes
`{status:"invalid", issues}` with exit code 2.
`init` builds a world from a scenario of spawn specs, and takes an optional third argument, a
coverage file, so a world can declare the categories it answers from the first command.

A world directory holds:
- `initial.json` and canonical `snapshot.json`. `snapshot.json` is written every 32 accepted
  commands (`WorldWriter.SnapshotEvery`), or at the interval `StoreWorld.Open` was given, so it may
  hold an earlier version than the log: `head.json` names the version it holds and the byte of
  `log.jsonl` that version was reached at, and the accepted commands after it are folded onto it on
  open;
- `templates.json`, the resolved template set the world was created with;
- `format.json`, `{"schema_version": 5}` (5 since the schedule can hold a `bleed`): a world with
  another number, or none, is refused `unsupported_schema` instead of being read;
- `ids.json`, when the scenario named anything;
- `log.jsonl`, every command as an attempt, refused ones included: its base version, the version it
  was decided at, status, and any reason code, data and candidates;
- `events.jsonl`, every emitted event, which queries read instead of replaying;
- `deltas.jsonl`, the deltas of every accepted command, one canonical line each, which
  the history of a field reads instead of replaying;
- `checkpoints/`, a cache and never a source of truth, made by `submit` after the head: every 256
  accepted commands the snapshot just written as `<version>-<next_seq>.json`;
- `head.json`, written last: the three JSONL files' sizes, all and accepted entry counts, the closed
  rounds the log holds (the next round's number), the version and log byte `snapshot.json` holds,
  and the template hash, so opening a world detects a crash without reading the log; a head without
  the count or the snapshot fields is settled by `load`, as one without the deltas size is;
- `lock`, there only while a process is writing: writers take turns ([locking.md](locking.md)).

Replay folds accepted commands over the initial snapshot; it is the source of truth. On open, a head
that agrees with the log and names a `snapshot.json` behind it folds the commands after that
snapshot's byte onto it; a snapshot that holds every accepted command is taken as current; anything
else (a head written before the log's last line, a snapshot that is neither) rebuilds the snapshot,
events, deltas and head from the log. A process keeps the current snapshot it last wrote or settled,
keyed by the head and `snapshot.json`'s own size and time, so its own writes are not folded again.
Snapshots are immutable, so every reader of the process shares the one it keeps; another writer's
head, or a hand edit, is read again and validated. Deltas are not folded: they record entity fields
only, not `tick`, `next_seq`, `rng`, `run` or `schedule`. An accepted command whose result breaks an
invariant is logged `invalid` and never written; that is a net for verb bugs, and the property
traces (`PropertyTraceTests`) fail when a command the engine accepts is ever caught by it. A stale
command is re-evaluated against the current snapshot and becomes `preempted` when it would have
succeeded at its base version.

**Scale.** What a command costs as the world grows is measured, not promised: see
[measurements-commands.md](measurements-commands.md) and `tools/WorldEngine.Bench`.

