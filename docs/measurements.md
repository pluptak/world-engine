# Measurements

Numbers taken from this code, kept apart from the backlog (which holds only what is planned) and from
the docs that say how the engine behaves. Each is a baseline for the machine named, not a threshold; a
new measurement is added here with the command that produced it, and a change that moves one updates it.

## Store: cost of a read

`npm run bench:reads` (`scripts/bench.ts --reads`): the four-entity world with a watcher beside the actor,
driven by alternating take and drop, and at each log length one call of each read a controller makes,
each timed once. `since` is `since(version - 10)`; `observe` is the watcher's, `since(version - 3)`, which
asks an event-form query for each event and each covered sense; `perceive` is one event-form query of an
event the observation did not ask about (a cold replay); `trace` is of an event's chain, or of a field's
history (the first call at that length, which parses what was appended since the last). Same machine as
below, ms:

| log (accepted commands) | 1000 | 5000 | 10000 |
|---|---|---|---|
| `since`, before / after checkpoints | 49 / 15 | 181 / 9 | 343 / 4 |
| `observe`, before / after | 509 / 102 | 2227 / 73 | 4486 / 44 |
| event-form `perceive`, before / after | 41 / 3 | 168 / 9 | 324 / 5 |
| `trace` of an event's chain, before / after | 41 / 2 | 181 / 3 | 366 / 3 |
| `trace` of a field's history, before / after stored deltas | 41 / 8 | 181 / 18 | 366 / 16 |
| the same `trace` of a field, called again | 2.5 | 4 | 4 |
| `attempts` (reads the log, replays nothing), before / after | 4.5 / 4 | 7 / 7 | 12 / 13 |

Before, every read replayed the whole log, so each grew in step with it and an `observe` of three
commands cost 4.5 s at ten thousand. After, the replay is at most 256 commands from the nearest
checkpoint, so `since`, `perceive` and `observe` stay flat (the small-log rows are dominated by the
process still warming up). A field's history was the one read that still replayed everything (52 /
213 / 379 ms with checkpoints alone); with its deltas stored it reads them as it reads events. A
process that has read nothing parses both files once: 63 ms for its first field trace at ten
thousand commands (3.2 MB of deltas, 2.3 MB of events, 1.3 MB of log), then 4 ms. The cost of a
checkpoint is one more write of the snapshot, and one read of the log, in every 256 commands; that
of `deltas.jsonl` is one append per command, which `npm run bench` does not show (4.1 then 4.9 ms
per command, first then last thousand, against 4.2 then 4.5 without it, the spread between runs).

## Store: cost of a command

`npm run bench:scale` (`scripts/bench.ts --scale`) runs 10k mixed commands (open, take,
put, take, drop, close, move, wait, each agent in turn) on a generated world of 20 rooms and 500
entities, 20 agents among tables, chests and stones, with 20 growing sprouts so processes run
throughout. Every 20th command is also run alone through the pipeline and the validator, so the
store's time splits into pipeline, validate and the rest (loading the snapshot, the log and event
appends, the snapshot write, the head). Measured on a Ryzen 5 5600 (12 threads), 32 GB, Windows 11,
Node 24, a baseline and not a threshold:

| | before | after the first fixes | props held to the schema |
|---|---|---|---|
| four-entity workload, ms per command (first / last 1k) | 4.2 / 4.1 | 3.9 / 4.0 | |
| 500 entities, ms per command (first / last 1k) | 13.7 / 13.6 | 10.6 / 10.6 | 11.4 / 11.3 |
| of which pipeline | 1.3 | 1.2 | 1.2 |
| of which validate | 1.0 | 1.0 | 1.3 |
| of which the rest (load, serialise, write) | 11.3 | 8.2 | 8.9 |

The first two columns predate the prop schema, under which the scale world no longer built; the last
is one run of the world `scripts/bench-world.ts` builds now (sprout's `size` declared, the chest an
openable preset), all 10k commands ok.

The snapshot is 152 kB at 500 entities. Cost does not grow along the run (first and last thousand
agree); it grows with the size of the world, and nearly all of it is reading, serialising and writing
the whole snapshot, not the engine: the pipeline is under 1.3 ms. The first fixes changed no behaviour:
`canonicalJson` quotes each key once instead of per object (3.4 to 1.4 ms for this snapshot), and
`load` keeps the version and hash of `initial.json` against the file's size and time instead of parsing
the whole file on every submission (4.1 to 2.4 ms). A per-handle cache of the last snapshot, checked
against the file's stamp and the head, was tried and dropped: the copy that keeps a caller from
holding the store's own object costs about what the parse saves (10.3 to 11.7 ms across runs, against
10.4). What is left is writing and serialising the whole snapshot on every command, which only a
delta log would change.

## Store: writers' turns

Four processes of fifty `take` and `drop` each on one four-entity world ([locking.md](locking.md)):
before the lock three of the four died with `EPERM` on the rename of `snapshot.json.tmp`, a name every
writer shared, and the log held 57 accepted commands at 54 distinct versions; after, all four exit
cleanly and the log holds 200 lines, 195 of them accepted at 195 distinct versions (the rest were
refused, as two processes racing for one stone must be). Taking the turn is an
exclusive create, a write, a close and an unlink of one small file, 0.37 ms alone. `npm run bench`,
three runs each, alternating between the code before and after, on the machine above: 4.2 / 4.0 ms
per command (first / last thousand, mean of the runs) before, 4.7 / 4.6 after, so about half a
millisecond more per command. A full existence check on top of the lock's, which `submit` already
does in `load`, had cost another 0.7 ms and was dropped for a single `existsSync`. Reads that find
the world whole take no turn and cost what they did.
