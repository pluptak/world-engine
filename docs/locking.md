# Writers take turns

A world directory has no server and the CLI is one process per request, so two requests at once
are two writers on the same files. Unguarded, each decides against a version the other has already
left and they rename each other's temporary files: four processes of fifty commands each lost
three of the four to `EPERM`, and the log held 57 accepted commands at 54 versions.

**The turn** is a file `lock` in the world (`src/store/lock.ts`), made with the exclusive flag,
which is atomic across processes, and holding `{ pid, since_ms }`. That clock reading only judges
the lock's age and never reaches the world. It is held by `submit` around the whole decision and
its writes, by `edit` around its default id (the count of logged submissions) and its submission,
by `upgradeTemplates` around its proof and its write, by `verify` around its whole replay, and by the repair in `load`. Within a
process it is re-entrant, since `submit` calls `load`. A memory world has no files and no turn.

**Reads** take none while the files agree. `load` trusts the snapshot when the head names the
template set, the three JSONL files are the sizes it says, and the snapshot is at the version its
accepted entries make; only a world that does not agree is settled under the turn, after looking
again. A read that overlaps a writer always disagrees (the log grows before the head is written),
so it waits for the writer instead of rebuilding files under it. `since`, `attempts`, `trace` and
`query` read the append-only files and take no turn either.

**Waiting.** A waiter polls every few milliseconds, longer as it goes, and past
`WORLD_LOCK_TIMEOUT_MS` (5 s by default) fails `store_busy`, a CLI issue code, having changed
nothing.

**A crash** leaves the lock behind. One whose process is gone, or that is over a minute old, is
renamed away (of two waiters judging it only one rename finds it) and the temporaries the dead
writer left are swept, those named for a pid that is gone or for the holder put out, never a live
process's, since the sweeper does not yet hold the turn; what it left half done is settled by `load`'s repair, since the log is the
truth ([persistence.md](persistence.md)). A lock with no owner written, its maker having died
between creating and filling it, is judged by the file's age.

**Temporaries** are named for the process (`snapshot.json.<pid>.tmp`). Windows will not replace a
file another process has open at that instant, so a replacement refused that way is asked again
for up to half a second.

**Limits.** It serialises processes on one machine over a local file system. A holder stalled for
over a minute loses its turn. A taker of a stale lock can race another taker doing the same, which
is the one window left. What it costs is in [measurements.md](measurements.md).
