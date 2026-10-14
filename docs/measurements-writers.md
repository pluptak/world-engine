# Store: writers' turns

*Measured on the TypeScript engine (tag `ts-final`); the commands and files named are its. The .NET
store's benchmark is `tools/WorldEngine.Bench`.*

Four processes of fifty `take` and `drop` each on one four-entity world
([locking.md](locking.md)): before the lock three of the four died with `EPERM` on the
rename of `snapshot.json.tmp`, a name every writer shared, and the log held 57 accepted
commands at 54 distinct versions; after, all four exit cleanly and the log holds 200 lines,
195 of them accepted at 195 distinct versions (the rest were refused, as two processes
racing for one stone must be). Taking the turn is an exclusive create, a write, a close
and an unlink of one small file, 0.37 ms alone. `npm run bench`, three runs each,
alternating between the code before and after, on the machine above: 4.2 / 4.0 ms per
command (first / last thousand, mean of the runs) before, 4.7 / 4.6 after, so about half a
millisecond more per command. A full existence check on top of the lock's, which `submit`
already does in `load`, had cost another 0.7 ms and was dropped for a single `existsSync`.
Reads that find the world whole take no turn and cost what they did.
