# Commands and persistence

The CLI is a JSON adapter over `World`: one request on stdin, one method, one response. Zod
validates that boundary, and a failure becomes `{status:"invalid", issues}` with exit code 2.
`init` builds a world from a scenario of spawn specs, and takes an optional third argument, a
coverage file, so a world can declare the categories it answers from the first command.

A world directory holds:
- `initial.json` and canonical `snapshot.json`;
- `templates.json`, the resolved template set the world was created with;
- `format.json`, `{"schema_version": 5}` (5 since the schedule can hold a `bleed`): a world with
  another number, or none, is refused `unsupported_schema` instead of being read;
- `ids.json`, when the scenario named anything;
- `log.jsonl`, every command as an attempt, refused ones included: its base version, the version it
  was decided at, status, and any reason code, data and candidates;
- `events.jsonl`, every emitted event, which queries read instead of replaying;
- `head.json`, written last: both JSONL files' sizes, all and accepted entry counts, and the
  template hash, so opening a world detects a crash without reading the log.

Replay folds accepted commands over the initial snapshot; it is the source of truth, and a mismatch
with the head rebuilds the snapshot, events and head from the log. An accepted command whose result
breaks an invariant is logged `invalid` and never written; that is a net for verb bugs, and the
property test fails when a command the engine accepts is ever caught by it. A stale command is
re-evaluated against the current snapshot and becomes `preempted` when it would have succeeded at
its base version.

A world loads the template set it was created with, so editing `templates/` reaches new worlds only.
`upgradeTemplates` moves a live world to a new set and refuses if a template lost a field an entity
uses (a part counts only with stored state or something in it), or if the log no longer replays to
the stored snapshot and event stream.

`npm run bench` runs 10k store commands on a four-entity world and holds about 4 ms per command from
first to last.

**Scale.** What a command costs as the world grows is measured, not promised: see
[measurements.md](measurements.md) (`npm run bench`, `npm run bench:scale`).

**A fork is not a copy on disk.** `world.fork()` (on a store world and a memory world alike) returns a
memory world that starts from a deep copy of the snapshot as it is now, with the same templates,
names, coverage and `rng`, so it continues the same dice. Its history begins at that version: `since`,
`attempts` and a `trace` of anything older throw `history_unavailable`, as for any memory world. It
writes no directory and appends to no log, and nothing it does reaches its parent or its other forks.
Keeping a fork is the caller's job through `snapshot()`.
