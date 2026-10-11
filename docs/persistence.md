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
- `deltas.jsonl`, the deltas of every accepted command, one canonical line each, which
  the history of a field reads instead of replaying;
- `checkpoints/`, a cache and never a source of truth, made by `submit` after the head: every 256
  accepted commands the snapshot just written as `<version>-<next_seq>.json`;
- `head.json`, written last: the three JSONL files' sizes, all and accepted entry counts, and the
  template hash, so opening a world detects a crash without reading the log;
- `lock`, there only while a process is writing: writers take turns ([locking.md](locking.md)).

Replay folds accepted commands over the initial snapshot; it is the source of truth, and a mismatch
with the head rebuilds the snapshot, events, deltas and head from the log. An
accepted command whose result breaks an invariant is logged `invalid` and never written;
that is a net for verb bugs, and the property test fails when a command the engine accepts
is ever caught by it. A stale command is re-evaluated against the current snapshot and
becomes `preempted` when it would have succeeded at its base version.

**Scale.** What a command costs as the world grows is measured, not promised: see
[measurements.md](measurements.md) (`npm run bench`, `npm run bench:scale`).

