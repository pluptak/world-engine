# After a crashed writer

What a writer that died holding the turn ([locking.md](locking.md)) leaves, and how the next one
cleans up.

**A crash** leaves the lock behind. One whose process is gone, or that is over a minute old, is
renamed away: of two waiters judging it, only one rename finds it, and the grave is asked for
patiently, up to a second, since a reader may have it open for a moment. Then the dead writer's
leftovers are swept:
- temporaries (`<name>.<pid>.tmp`) and graves (`lock.stale-<pid>`) named for a pid that is gone,
  for the holder put out, or for the sweeper itself, which writes nothing while it sweeps;
- never for another process that is alive, since the sweeper does not yet hold the turn;
- a temporary named for no pid is an old one and goes too.

What the writer left half done is settled by `load`'s repair, since the log is the truth
([persistence.md](persistence.md)). A lock with no owner written, its maker having died between
creating and filling it, is judged by the file's age.

**Temporaries** are named for the process (`snapshot.json.<pid>.tmp`). Windows will not replace a
file another process has open at that instant, so a replacement refused that way is asked again
for up to half a second.
