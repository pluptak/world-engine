# Writers take turns

A world directory has no server and the CLI is one process per request, so two requests at once are
two writers on the same files, each deciding against a version the other has left.

**The turn** is a file `lock` in the world (`src/store/lock.ts`), made with the exclusive flag,
which is atomic across processes, and holding `{ pid, since_ms }`. That clock reading only judges
the lock's age and never reaches the world. It is held by `submit` around the whole decision and its
writes, by `edit` around its default id (the count of logged submissions) and its submission, by
`upgradeTemplates` around its proof and its write, by `verify` around its whole replay, and by the
repair in `load`. Within a process it is re-entrant, since `submit` calls `load`. A memory world has
no files and no turn.

**Reads** take none while the files agree. `load` trusts the snapshot when the head names the
template set, the three JSONL files are the sizes it says, and the snapshot is at the version its
accepted entries make; only a world that does not agree is settled under the turn, after looking
again. A read that overlaps a writer always disagrees (the log grows before the head is written), so
it waits for the writer instead of rebuilding files under it. `since`, `attempts`, `trace` and
`query` read the append-only files and take no turn either; a last line without its newline is a
write under way, absent until it ends. Under the turn it is a cut-off write, which `load` refuses.

**Waiting.** A waiter polls every few milliseconds, longer as it goes, and past
`WORLD_LOCK_TIMEOUT_MS` (5 s by default) fails `store_busy`, a CLI issue code, having changed
nothing.

**A crash** leaves the lock behind; taking it over and sweeping what the dead writer left is
[locking-crash.md](locking-crash.md).

**Limits.** It serialises processes on one machine over a local file system. A holder stalled for
over a minute loses its turn. A taker of a stale lock can race another taker doing the same, which
is the one window left. What it costs is in [measurements-writers.md](measurements-writers.md).
