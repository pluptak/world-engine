# Measurements

Numbers taken from this code, kept apart from the backlog (which holds only what is planned) and
from the docs that say how the engine behaves. Each is a baseline for the machine named, not a
threshold; a new measurement is added with the command that produced it, and a change that moves
one updates it. What a command costs is in [measurements-commands.md](measurements-commands.md);
what writers' turns cost is in [measurements-writers.md](measurements-writers.md).

## Store: cost of a read

`npm run bench:reads` (`scripts/bench.ts --reads`): the four-entity world with a watcher
beside the actor, driven by alternating take and drop, and at each log length one call
of each read a controller makes, each timed once. `since` is `since(version - 10)`;
`observe` is the watcher's, `since(version - 3)`, which asks an event-form query for each
event and each covered sense; `perceive` is one event-form query of an event the
observation did not ask about (a cold replay); `trace` is of an event's chain, or of a
field's history (the first call at that length, which parses what was appended since the
last). Same machine as in [measurements-commands.md](measurements-commands.md), ms:

| log (accepted commands) | 1000 | 5000 | 10000 |
|---|---|---|---|
| `since`, before / after checkpoints | 49 / 15 | 181 / 9 | 343 / 4 |
| `observe`, before / after | 509 / 102 | 2227 / 73 | 4486 / 44 |
| event-form `perceive`, before / after | 41 / 3 | 168 / 9 | 324 / 5 |
| `trace` of an event's chain, before / after | 41 / 2 | 181 / 3 | 366 / 3 |
| `trace` of a field's history, before / after stored deltas | 41 / 8 | 181 / 18 | 366 / 16 |
| the same `trace` of a field, called again | 2.5 | 4 | 4 |
| `attempts` (reads the log, replays nothing), before / after | 4.5 / 4 | 7 / 7 | 12 / 13 |

Before, every read replayed the whole log, so each grew in step with it and an `observe`
of three commands cost 4.5 s at ten thousand. After, the replay is at most 256 commands
from the nearest checkpoint, so `since`, `perceive` and `observe` stay flat (the small-log
rows are dominated by the process still warming up). A field's history was the one read
that still replayed everything (52 / 213 / 379 ms with checkpoints alone); with its deltas
stored it reads them as it reads events. A process that has read nothing parses both files
once: 63 ms for its first field trace at ten thousand commands (3.2 MB of deltas, 2.3 MB of
events, 1.3 MB of log), then 4 ms. The cost of a checkpoint is one more write of the
snapshot, and one read of the log, in every 256 commands; that of `deltas.jsonl` is one
append per command, which `npm run bench` does not show (4.1 then 4.9 ms per command,
first then last thousand, against 4.2 then 4.5 without it, the spread between runs).

## Store: cost of a round

`npm run bench:rounds` (`scripts/bench.ts --rounds`, `scripts/bench-rounds.ts`): the scale world of
500 entities in 20 rooms, eight of its agents registered as players of one run. Each of 1,000 rounds
has one move per player, through its handle, then the director closes it; then 200 closing ticks
with every player idle, then 200 quiet rounds closed by `closeRounds` (one round each), which look
at what the round made. Per round, ms, on the machine in
[measurements-commands.md](measurements-commands.md):

| | ms per round |
|---|---|
| a round of eight moves, first 100 / last 100 | 223 / 220 |
| submits (eight, through the handles) | 114 |
| the round's check (`planRound`, on its own) | 7 |
| the moves' apply | 89 |
| the closing tick (a round with no move) | 16 |
| a quiet round, total | 42 |
| of which the observation (the look at what the round made) | 26 |
| one player's `observe` per round, before / after | 2,946 | 162 |
| of which the snapshot's load | 2.5 | 2.5 |
| the events' read | 1.3 | 1.3 |
| the entity half of the projection | 30 | 28 |
| the event half of the projection | 2,912 | 130 |

Before, the same bench on the same machine gave a quiet round of 1,104 (observation 1,067): each
registered body was asked `observe` since the round began, reading the events again every time. The
round's number was read from the whole log each round; it is now read from the head's count. A round
of moves barely changes over the run (223 against 220 ms); what is left of it is the submits. The
earlier figure in this section (1,575 for a quiet round) timed a loop of `observe` calls in the
bench itself, not `closeRounds`, so it is not comparable to these.

One player's `observe` is split into the snapshot's load, the events' read, the entity half of
the projection (timed directly) and the event half (the full observe less the other three).
Before, the event half replayed the log once per event, each with its own validation hash of the
log, so it grew with the log and reached 2,912 ms. After, one replay answers the whole call's
events (`replayUntilEvents`), and the answers are byte-identical: every agent's projection of
the scale world and of the lab is pinned by `tests/observe-projection.test.ts`. Nothing is
cached across calls or written to the world.
