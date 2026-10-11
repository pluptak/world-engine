# Scheduled causes

Something the world does by itself, later. A snapshot's `schedule` lists
what is pending, ordered by due tick, absent when nothing is pending (`src/engine/schedule.ts`).

**Kinds.** Four: `close` ([verbs-openables.md](verbs-openables.md)),
`bleed` ([bleeding.md](bleeding.md)), `process`
([processes.md](processes.md)), `beat` ([beats.md](beats.md)). One table,
`CAUSE_TABLE` in `src/engine/schedule.ts`, names every member of
`ScheduledCause` (a missing one does not compile) and gives each its
`run` and the rule a stored cause can break (`invalid`, read by `validateSnapshot`). The
response schema in `src/contract.ts` repeats the stored shapes, and `tests/schedule.test.ts`
holds the two in step.

**Running.** The clock runs causes as it passes their tick
([time.md](time.md)): modifiers due expire first, then the causes
due run in schedule order, each emitting under its `cause_id`.

**Overtaken causes.** A cause that finds nothing to do (the door
already shut, say by an edit) is taken off the schedule and emits
nothing. A cause whose entity is removed goes with it, pruned once
the transition has run. Only a close touches more than its own entity,
moving its gate's occupants.

**Stored one way.** `validateSnapshot` refuses a schedule that is not
one stored form:
- empty (`empty_schedule`), not ahead of the clock
  (`schedule_not_ahead`), or out of due order (`schedule_unordered`).
- on a missing entity (`schedule_dangling`) or of an unknown kind
  (`unknown_cause_kind`).
- a bleed with none left (`bleed_not_remaining`).
- a process with no id (`invalid_process`), or pending twice on one
  entity (`duplicate_process`).
- a malformed beat (`invalid_beat`), a beat id used twice
  (`duplicate_beat`), or more than 256 (`too_many_beats`).
The schedule is not a field of any entity. Like `tick`, its changes are not deltas;
the events are the record. Stored worlds are `schema_version` 5 since.

`tests/schedule.test.ts` is the spec; property runs cover schedule,
withdraw, overtake, remove. Pushed-aside gate: `tests/scenario-cell.test.ts`.
