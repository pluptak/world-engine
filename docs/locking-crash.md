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

**Every write of a submit.** `TamperGoldenTests` damages a stored world one file at a time (a line
dropped or doubled, a file cut, emptied or gone) and checks what opening and `verify` make of it,
against the TypeScript store, whose own test stopped a submit after each of its writes.

**Temporaries** are named for the process (`snapshot.json.<pid>.tmp`). Windows will not replace a
file another process has open at that instant, so a replacement refused that way is asked again
for up to half a second.
