# After a crashed writer

What a writer that died holding the turn ([locking.md](locking.md)) leaves, and how the next one
cleans up.

**A crash** leaves the lock behind. One whose process is gone, or that is over a minute old, is
renamed away by one taker at a time: a taker holds `lock.takeover` open exclusively (the operating
system frees it if the taker dies, and it is deleted on close), reads the lock again under it, and
renames only the bytes it judged. The grave is asked for patiently, up to a second, since a reader
may have it open for a moment; a taker's own grave left from an earlier takeover is deleted before
the rename. Then the dead writer's leftovers are swept:
- temporaries (`<name>.<pid>.tmp`) and graves (`lock.stale-<pid>`) named for a pid that is gone,
  for the holder put out, or for the sweeper itself, which writes nothing while it sweeps;
- never for another process that is alive, since the sweeper does not yet hold the turn;
- a temporary named for no pid is an old one and goes too.

A grave whose delete lost to a reader is not left for the next takeover: every holder, before it
gives the turn back, removes the graves of dead pids and its own.

What the writer left half done is settled by `load`'s repair, since the log is the truth
([persistence.md](persistence.md)). A lock with no owner written, its maker having died between
creating and filling it, is judged by the file's age.

**Every write of a submit.** `tests/submit-crash.test.ts` stops a submit after each of its writes (the
log line, events, deltas, snapshot, head, checkpoint), over seven commands with snapshot.json every 3
and a checkpoint every 2. Each stop must open to the state the uninterrupted run gives, and verify.

**Temporaries** are named for the process (`snapshot.json.<pid>.tmp`). Windows will not replace a
file another process has open at that instant, so a replacement refused that way is asked again
for up to half a second.
