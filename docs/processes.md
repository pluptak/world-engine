# Processes

A thing that changes by itself while a condition on its props holds: a candle that burns down while
it burns, moss that grows. A template declares it as data, the third kind of scheduled cause
([schedule.md](schedule.md)), and every run is an event, so what a process did is read back like
anything else.

**Declaring.** A template's optional `processes` is a list of
`{ id, every_ticks, chance_pct?, while?, effect }`. `every_ticks` is an integer of at least 1.
`effect` is `{ adjust_prop: { prop, by, min?, max? } }`: every `every_ticks` ticks the entity's
integer prop `prop` moves by the non-zero integer `by`, clamped at `min` when `by` is negative
and `max` when it is positive. `while` is `{ prop, op, value }` with `op` one of
`eq ne lt lte gt gte`; `eq` and `ne` compare any primitive strictly, and the ordering ops need
numbers (an absent prop satisfies `ne` and nothing else). Without `while` the process runs whenever
the prop can move. A bad shape, an unknown field, a repeated id, `min` above `max` or a zero `by`
is refused when the templates load, naming the template and the process.

**Extends.** `extends` merges processes by id, as it does props:
the parent's list, each replaced by a child's of the same id, then the child's
new ones. A template that declares none has no `processes` key at all, so its place
in `templates_hash` is what it was before processes existed.

**Starting and stopping.** Nothing polls. The schedule is brought in line with the props where they
can change: after any command's own changes, and after each cause has run, every entity whose props
changed, that was spawned or that was refined into another preset ([refine.md](refine.md)) is
reconciled (`reconcile` in `src/engine/process.ts`). A process that can
run and has nothing pending is scheduled `every_ticks` from now, its
cause the last event that touched the entity (the `edited`, `spawned`,
or the `changed` before it); a pending one that can no longer run is
withdrawn, recording nothing. A process can run when its `while` holds
and its prop is an
integer not yet at the bound it is moving toward, so one that reaches
`min` or `max` simply ends, and starts again if an edit lifts the prop off the bound.

**Running.** Each run re-reads the entity's props: if the process can no longer run it does nothing.
Otherwise it emits `changed` `{ prop, from, to, process }` under its
cause, writes the prop (a delta on `props`), and the reconcile that
follows schedules the next run. The chain reads `edited` → `changed` →
`changed`, and `trace` of the prop walks it. A run happens during whichever command spans its tick,
`advance` or not.
