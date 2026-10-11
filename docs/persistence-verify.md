# Verify and upgrade

**Verifying.** `load` trusts files whose sizes match the head, and a world opened with its files out
of step is settled by bringing the head into line with them, so neither proves a world is what its
log says. `verify` does. `World.verify()` checks an open store world; `verifyWorld(dir)` checks one
that is not open, which is how a damaged world is checked, since `openWorld` settles the files
first, and the CLI's `verify` op (`world`) goes that way. A memory world keeps no log and throws
`history_unavailable`. Either way it replays `log.jsonl` from `initial.json`, deciding each line
again by the rule `submit` applies (the same `resolveSubmission`: a stale base is judged at the
version it names, the validity gate included), and compares canonical bytes. A line of the log must
be exactly the attempt its command is decided to; the events and deltas those commands make must be
exactly the lines of `events.jsonl` and `deltas.jsonl`; the final snapshot exactly `snapshot.json`;
each checkpoint exactly the file this replay would have written on reaching its version, bound to
the log prefix and `initial.json` that were there then, since readers start from its snapshot and a
stale command is judged against the ones it keeps (a changed one changes what `since` answers). The
first difference is reported as `{ file, line, code }`, checked in that order: the log, then events,
deltas, the snapshot and the checkpoints by version. Answers `{ ok: true, entries, version }`, else
`{ ok: false, divergence }` for the first difference. `line` is 1-based (0 for the snapshot and a
checkpoint, whose file is `checkpoints/<name>`); `code` is `differs` (other bytes), `missing` (the
file ends before the log's line), `extra` (it goes on past it, has text after its last newline, or
is a checkpoint for a version the log has not reached) or `status_differs` (a log line whose command
is decided to another status or reason code, as a hand-edited status or a line taken out of the
middle shows). A refused command's line is the only record of it, so a refused line edited into
another faithful attempt is not a divergence. A set that is not the one `initial.json` carries is
`templates_changed`, as everywhere. It writes nothing, not the repairs `load` would make, and holds
the turn while it reads, since a writer half done would read as a divergence (`store_busy` after the
usual wait). A checkpoint may be missing, since it is written last and may fail, and a file in
`checkpoints/` that is no checkpoint's name is left alone. The head is a cache of these files and is
not compared: after a crash it is behind them, and `load` mends it.

A world loads the template set it was created with, so editing `templates/` reaches new worlds only.
`upgradeTemplates` moves a live world to a new set and refuses if a template lost a field an entity
uses (a part counts only with stored state or something in it), or if the log no longer replays to
the stored snapshot and event stream.
