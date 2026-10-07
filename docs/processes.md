# Processes

A thing that changes by itself while a condition on its props holds: a candle that burns down while
it burns, moss that grows. A template declares it as data, the third kind of scheduled cause
([schedule.md](schedule.md)), and every run is an event, so what a process did is read back like
anything else.

**Declaring.** A template's optional `processes` is a list of
`{ id, every_ticks, while?, effect }`. `every_ticks` is an integer of at least 1. `effect` is
`{ adjust_prop: { prop, by, min?, max? } }`: every `every_ticks` ticks the entity's integer prop
`prop` moves by the non-zero integer `by`, clamped at `min` when `by` is negative and `max` when it is
positive. `while` is `{ prop, op, value }` with `op` one of `eq ne lt lte gt gte`; `eq` and `ne`
compare any primitive strictly, and the ordering ops need numbers (an absent prop satisfies `ne` and
nothing else). Without `while` the process runs whenever the prop can move. A bad shape, an unknown
field, a repeated id, `min` above `max` or a zero `by` is refused when the templates load, naming the
template and the process.

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
edits light and snuff, and moss that grows from the start, so random runs start, withdraw and restart
processes under every property.

What it does not do yet: a bound only ends the process (no `then`), nothing but a prop moves, and a
run is not random.
