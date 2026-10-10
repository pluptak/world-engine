# Seeded randomness

Chance has to replay exactly, so the dice are part of the world: a 32-bit state in the snapshot, not
`Math.random` and not the clock. The same seed and the same commands roll the same numbers through
any handle, through a reopen and through replay of the log.

**State.** `Snapshot.rng` is a whole number from 0 to 2^32 - 1, absent in a world that was never
given a seed. `src/engine/rng.ts` holds the generator (mulberry32, written out so no dependency
decides what a replay means): `nextRandom(state)` is a number in [0, 1) and the state after it.
`validateSnapshot` refuses anything else (`invalid_rng`).

**Rolling.** A transition asks `TransitionContext.random()`, which returns the next number and writes
the new state into the working snapshot, so the state moves exactly when the command lands. A
refused, invalid, `check`ed or preempted command returns the snapshot it was given and so never
advances the dice; the dry run that decides whether a stale command was preempted rolls on a
discarded copy. Rolls are drawn in the order things happen, which is the order the clock runs them.

**Seeding.** `createWorld` and `memoryWorld` take `seed` in their options (a `memoryWorld` seed
replaces the snapshot's own); a seed that is no state throws a `TypeError` before anything is built.
A scenario file for the CLI's `init` is either the list of entries or `{ "seed": n, "entities": [...] }`.
The author's `edit` of kind `{ kind: "set_seed", seed }` replaces the state; it has no target, and its
only record is the `edit` event. Nothing ever invents a seed: a command that would roll in a world
that has none is refused `no_seed` (a code the world owns, so no verb lists it) and changes nothing,
whichever part of the command reached the roll, the verb itself or a process that fell due as the
clock moved. A caller that wants chance gives the world a seed first.

**First consumer.** A template process may declare `chance_pct`, a whole number from 1 to 99
([processes.md](processes.md)): each run rolls once, and a roll at or above the chance is a miss. A
miss writes nothing and emits nothing, but the next run is scheduled as if the run had happened, so
the process keeps trying. A hit is a run like any other. Attack hit chance is not built on this yet.

**Second consumer.** A remote command to a device with a `jam_pct` rolls once and is jammed under
that chance ([jam.md](jam.md)).

`tests/seed.test.ts` is the spec. The property test's worlds are seeded, its `lichen` rolls on every
tick it can, and the generator now and then replaces the state with an edit.
