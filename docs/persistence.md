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
- `deltas.jsonl`, the deltas of every accepted command, one canonical line each, which the history of a
  field reads instead of replaying;
- `checkpoints/`, a cache and never a source of truth, made by `submit` after the head: every 256
  accepted commands the snapshot just written as `<version>-<next_seq>.json`;
- `head.json`, written last: the three JSONL files' sizes, all and accepted entry counts, and the
  template hash, so opening a world detects a crash without reading the log;
- `lock`, there only while a process is writing: writers take turns ([locking.md](locking.md)).

Replay folds accepted commands over the initial snapshot; it is the source of truth, and a mismatch
with the head rebuilds the snapshot, events, deltas and head from the log. An accepted command whose result
breaks an invariant is logged `invalid` and never written; that is a net for verb bugs, and the
property test fails when a command the engine accepts is ever caught by it. A stale command is
re-evaluated against the current snapshot and becomes `preempted` when it would have succeeded at
its base version.

**Checkpoints.** A read that wants history from some version on (`since`, an event-form `query`, the
snapshot a stale command was based on) starts from the newest checkpoint at or before that point and
replays only the log after it, not the log from the start. A checkpoint carries the version, the template
hash, the length, line count and SHA-256 of the log bytes that made it, and the SHA-256 of
`initial.json`; one that does not parse, names another template set, is ahead of the log, or whose
log prefix or initial snapshot is not the world's own is ignored, and with none usable the read replays
from `initial.json` as before, with the same answer byte for byte. A new template set (`upgradeTemplates`,
or a settled move) removes them, so the next ones are made under it. An event-form `query` finds its
event's checkpoint by number alone, since event ids count the same sequence as the snapshot's
`next_seq`, and the events it needs for cause chains come from `events.jsonl`, which a handle parses once
and then extends by the lines appended since (checked against the bytes just before them, so a file
that was rewritten is read again). Every reader of the log, events and deltas takes only the bytes
through the last newline, so a line a writer is still appending waits for the next read. A store world keeps its last sixteen event replays, so one observation
asks the log once per event rather than once per sense. What a read costs as the log grows is in
[measurements.md](measurements.md).

**Deltas.** `submit` appends an accepted command's deltas after its events and before the snapshot,
so a snapshot at the log's version means the file is whole. `trace` of an event's chain reads
`events.jsonl` alone and `trace` of a field's history reads `deltas.jsonl` with it, each parsed
once per handle and extended by the lines appended since, with no replay. `load` trusts the file
when its size is the head's `deltas_bytes`; it rebuilds it from the log when it is missing, shorter
than the head says (appends only grow it, so no crash does that), or the head has no size for it (a
world made before the file existed, or whose head was lost). The file is derived from the log, as
the events are, so `schema_version` stays 5: an older world opens and gains it. `upgradeTemplates`
and a settled template move hold it to the replay as they hold the events. `since` still replays,
from a checkpoint.

**Verifying.** `load` trusts files whose sizes match the head, and a world opened with its files out of
step is settled by bringing the head into line with them, so neither proves a world is what its log says.
`verify` (`World.verify()`, `verifyWorld(dir)`, the CLI's `verify` op) does: it replays `log.jsonl` from
`initial.json`, deciding each line again by the rule `submit` applies (the same `resolveSubmission`: a
stale base is judged at the version it names, the validity gate included), and compares canonical bytes. A
line of the log must be exactly the attempt its command is decided to; the events and deltas those
commands make must be exactly the lines of `events.jsonl` and `deltas.jsonl`; the final snapshot exactly
`snapshot.json`; each checkpoint exactly the file this replay would have written on reaching its version,
bound to the log prefix and `initial.json` that were there then, since readers start from its snapshot and a
stale command is judged against the ones it keeps (a changed one changes what `since` answers). The first
difference is reported as `{ file, line, code }`, checked in that order: the log, then events, deltas, the
snapshot and the checkpoints by version. `line` is 1-based (0 for the snapshot and a checkpoint, whose file
is `checkpoints/<name>`); `code` is `differs` (other bytes), `missing` (the file ends before the log's line),
`extra` (it goes on past it, has text after its last newline, or is a checkpoint for a version the log has
not reached) or `status_differs` (a log line whose command is decided to another status or
reason code, as a hand-edited status or a line taken out of the middle shows). A refused command's line is
the only record of it, so a refused line edited into another faithful attempt is not a divergence. A set
that is not the one `initial.json` carries is `templates_changed`, as everywhere. It writes nothing, not
the repairs `load` would make, and holds the turn while it reads, since a writer half done would read as
a divergence (`store_busy` after the usual wait). A checkpoint may be missing, since it is written last and
may fail, and a file in `checkpoints/` that is no checkpoint's name is left alone. The head is a cache of
these files and is not compared: after a crash it is behind them, and `load` mends it.

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
