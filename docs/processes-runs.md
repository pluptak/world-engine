# Process runs

**A world's first processes.** A world built from a scenario has no event behind it, so
`createWorld` calls `startProcesses`, which reconciles every entity with
a cause of `null`: the first `changed` of such a process is a root. A
caller that builds a snapshot itself and opens it with `memoryWorld` calls
`startProcesses(snapshot, registry)` first if it wants them running; otherwise a
process starts the first time something touches its entity. `startProcesses` is exported for this.

**Perception.** `changed` is read like a hand act: seen by whoever sees the entity in a lit room,
never heard, never smelt, felt only by the body it is on (`silent` in [senses.md](senses.md)).

**Stored one way.** A `process` cause is `{ due_tick, kind: "process", entity, cause_id | null,
process }`. `validateSnapshot` refuses an empty `process` (`invalid_process`)
and a second pending run of one process on one entity (`duplicate_process`).
It does not check the template still declares the process: after an upgrade
that drops it the cause finds nothing to do and ends.

**Rate from a prop.** A process may declare `every_ticks_prop`, the name of
a prop of the entity. When a run is scheduled, its delay is that prop if it
is a positive whole number, else `every_ticks`. The run already pending keeps
the delay it was given; the one after it reads the prop then. So a body that
rests can hunger slower (`hunger_every: 20`) or an ember burn faster, set by
an edit or by whatever else writes the prop. A non-string or empty name is
refused when the templates load.

**Chance.** A process may declare `chance_pct`, a whole number from 1 to 99:
each run rolls the world's dice ([rng.md](rng.md)), and a miss writes and
emits nothing while the next run is scheduled as though it had happened.
Without a seed, a run that would roll refuses the command `no_seed`.

`tests/process.test.ts` is the spec. The property test's scenario has a candle the generator's prop
edits light and that snuffs itself when its fuel is gone, moss that grows from the start and is
then hurt, and mold that spreads once and is then removed, so random runs start, withdraw, restart
and end processes under every property.
