# Processes

A thing that changes by itself while a condition on its props holds: a candle that burns down while
it burns, moss that grows. A template declares it as data, the third kind of scheduled cause
([schedule.md](schedule.md)), and every run is an event, so what a process did is read back like
anything else.

**Declaring.** A template's optional `processes` is a list of
`{ id, every_ticks, chance_pct?, while?, effect }`. `every_ticks` is an integer of at least 1. `effect` is
`{ adjust_prop: { prop, by, min?, max? } }`: every `every_ticks` ticks the entity's integer prop
`prop` moves by the non-zero integer `by`, clamped at `min` when `by` is negative and `max` when it is
positive. `while` is `{ prop, op, value }` with `op` one of `eq ne lt lte gt gte`; `eq` and `ne`
compare any primitive strictly, and the ordering ops need numbers (an absent prop satisfies `ne` and
nothing else). Without `while` the process runs whenever the prop can move. A bad shape, an unknown
field, a repeated id, `min` above `max` or a zero `by` is refused when the templates load, naming the
template and the process.

**Then.** A process may declare `then`, once, for the run that brings the prop to the bound it was
moving toward (`min` for a negative `by`, `max` for a positive one, so a `then` with no such bound is
refused when the templates load). Exactly one of:

- `{ set_prop: { prop, value } }`: a second `changed` under the first, writing a prop of the entity
  (`from` is `null` when the prop was absent). Writing the prop a condition reads is how a candle
  snuffs itself: `edited` → `changed` (fuel 0) → `changed` (burning false).
- `{ damage: { amount } }`: takes integrity under a `damaged`, or a `destroyed` that sets the status
  when none is left and drops what the body held, each fall caused by the `destroyed`. It is the same
  function a bleed uses (`hurt` in `src/engine/harm.ts`), so a body that starves out reads like one
  that bled out.
- `{ remove: true }`: a `removed` under the run, the author's removal (`removeEntity` in
  `src/engine/verbs/edit.ts`): what it hid is uncovered and what it held or carried is let go. A room
  someone is in is not removed, as for the author, and the `then` does nothing. Whatever else was
  scheduled on a removed entity goes with it.

An entity that is destroyed runs no process: it is no longer reconciled, so a starved body's hunger
stays where it ended.

**Extends.** `extends` merges processes by id, as it does props: the parent's list, each replaced by a
child's of the same id, then the child's new ones. A template that declares none has no `processes`
key at all, so its place in `templates_hash` is what it was before processes existed.

**Starting and stopping.** Nothing polls. The schedule is brought in line with the props where they
can change: after any command's own changes, and after each cause has run, every entity whose props
changed or that was spawned is reconciled (`reconcile` in `src/engine/process.ts`). A process that can
run and has nothing pending is scheduled `every_ticks` from now, its cause the last event that touched
the entity (the `edited`, `spawned`, or the `changed` before it); a pending one that can no longer
run is withdrawn, recording nothing. A process can run when its `while` holds and its prop is an
integer not yet at the bound it is moving toward, so one that reaches `min` or `max` simply ends, and
starts again if an edit lifts the prop off the bound.

**Running.** Each run re-reads the entity's props: if the process can no longer run it does nothing.
Otherwise it emits `changed` `{ prop, from, to, process }` under its cause, writes the prop (a delta on
`props`), and the reconcile that follows schedules the next run. The chain reads `edited` → `changed` →
`changed`, and `trace` of the prop walks it. A run happens during whichever command spans its tick,
`advance` or not.

**A world's first processes.** A world built from a scenario has no event behind it, so
`createWorld` calls `startProcesses`, which reconciles every entity with a cause of `null`: the first
`changed` of such a process is a root. A caller that builds a snapshot itself and opens it with
`memoryWorld` calls `startProcesses(snapshot, registry)` first if it wants them running; otherwise a
process starts the first time something touches its entity.

**Perception.** `changed` is read like a hand act: seen by whoever sees the entity in a lit room,
never heard, never smelt, felt only by the body it is on (`silent` in [senses.md](senses.md)).

**Stored one way.** A `process` cause is `{ due_tick, kind: "process", entity, cause_id | null,
process }`. `validateSnapshot` refuses an empty `process` (`invalid_process`) and a second pending run
of one process on one entity (`duplicate_process`). It does not check the template still declares the
process: after an upgrade that drops it the cause finds nothing to do and ends.

`tests/process.test.ts` is the spec; the property test's scenario has a candle the generator's prop
edits light and that snuffs itself when its fuel is gone, moss that grows from the start and is then
hurt, and mold that spreads once and is then removed, so random runs start, withdraw, restart and
end processes under every property.

**Rate from a prop.** A process may declare `every_ticks_prop`, the name of a prop of the entity. When a
run is scheduled, its delay is that prop if it is a positive whole number, else `every_ticks`. The run
already pending keeps the delay it was given; the one after it reads the prop then. So a body that
rests can hunger slower (`hunger_every: 20`) or an ember burn faster, set by an edit or by whatever
else writes the prop. A non-string or empty name is refused when the templates load.

**Chance.** A process may declare `chance_pct`, a whole number from 1 to 99: each run rolls the world's
dice ([rng.md](rng.md)), and a miss writes and emits nothing while the next run is scheduled as
though it had happened. Without a seed, a run that would roll refuses the command `no_seed`.

What it does not do yet: nothing but a prop moves (no spreading to a neighbour, no spawning).

**What ships.** `templates/lantern.json` burns a point of fuel a tick while `burning` and snuffs itself
at 0, and `candle` extends it with less ([verbs-other.md](verbs-other.md), `light`). `human_hungry`
extends `human` (and needs its own companions, `human_hungry.arm_l` and the rest) with `hunger` and
`starvation`: hunger rises a point every 10 ticks to 100, and at 100 `starvation` rises every 5 ticks
to 20, whose `then` takes all of the body's integrity. The rise reads `hunger_every` (10 by default) for
its delay. Eating lowers `hunger` below 100, which withdraws the starving and starts the rise again
([verbs-holding.md](verbs-holding.md), `consume`); and while `hunger` is below 100 a `recover` process
winds `starvation` back down a point every 5 ticks to 0, so a body that eats after a lapse recovers. `human` is unchanged, so worlds without a hungry body keep their hash.
