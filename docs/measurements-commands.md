# Store: cost of a command

`npm run bench:scale` (`scripts/bench.ts --scale`) runs 10k mixed commands (open, take,
put, take, drop, close, move, wait, each agent in turn) on a generated world of 20 rooms
and 500 entities, 20 agents among tables, chests and stones, with 20 growing sprouts so
processes run throughout. Every 20th command is also run alone through the pipeline and
the validator, so the store's time splits into pipeline, validate and the rest (loading
the snapshot, the log and event appends, the snapshot write, the head). Measured on a
Ryzen 5 5600 (12 threads), 32 GB, Windows 11, Node 24, a baseline and not a threshold:

| | before | after the first fixes | props held to the schema |
|---|---|---|---|
| four-entity workload, ms per command (first / last 1k) | 4.2 / 4.1 | 3.9 / 4.0 | |
| 500 entities, ms per command (first / last 1k) | 13.7 / 13.6 | 10.6 / 10.6 | 11.4 / 11.3 |
| of which pipeline | 1.3 | 1.2 | 1.2 |
| of which validate | 1.0 | 1.0 | 1.3 |
| of which the rest (load, serialise, write) | 11.3 | 8.2 | 8.9 |

The first two columns predate the prop schema, under which the scale world no longer
built; the last is one run of the world `scripts/bench-world.ts` builds now (sprout's
`size` declared, the chest an openable preset), all 10k commands ok.

The snapshot is 152 kB at 500 entities. Cost does not grow along the run (first and last
thousand agree); it grows with the size of the world, and nearly all of it is reading,
serialising and writing the whole snapshot, not the engine: the pipeline is under 1.3 ms.
The first fixes changed no behaviour: `canonicalJson` quotes each key once instead of per
object (3.4 to 1.4 ms for this snapshot), and `load` keeps the version and hash of
`initial.json` against the file's size and time instead of parsing the whole file on every
submission (4.1 to 2.4 ms). A per-handle cache of the last snapshot, checked against the
file's stamp and the head, was tried and dropped: the copy that keeps a caller from holding
the store's own object costs about what the parse saves (10.3 to 11.7 ms across runs,
against 10.4). What is left is writing and serialising the whole snapshot on every command,
which only a delta log would change.

**Snapshot every 32 commands** (`SNAPSHOT_EVERY`, `src/store/file-store.ts`). Measured on the same
machine, one run each, ms per command (first / last 1k). Before the change, the rows above:

| | before | snapshot every 32 |
|---|---|---|
| four-entity workload (`npm run bench`) | 4.77 / 4.73 | 3.77 / 3.53 |
| 500 entities (`npm run bench:scale`) | 12.30 / 12.19 | 7.49 / 7.81 |
| of which the rest (load, serialise, write) | 8.91 | 4.80 |

The rest falls because the snapshot is written on one command in 32 and the head names the version
it holds; the commands since are folded from the log on open, and a process that holds the world keeps
its current snapshot in memory, so its own commands fold nothing. The pipeline and validate phases are
unchanged. The snapshot is 153 kB at 500 entities, as before.
