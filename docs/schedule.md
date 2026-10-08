# Scheduled causes

Something the world does by itself, later: a self-closing door, a wound that bleeds, and a template's
process ([processes.md](processes.md)). A snapshot's `schedule` lists what is pending, each cause with
its `due_tick`, `kind` (`close`, `bleed`, `process` or `beat`), `entity` and `cause_id`, the event that set it
going (null for a process the initial state started); a bleed also carries `remaining` and a process
its `process` id. It
is ordered by due tick, then by when each was scheduled, and absent when nothing is pending, so a
world that never schedules anything stores nothing for it (`src/engine/schedule.ts`).

**Kinds.** A kind lives in one table, `CAUSE_TABLE` in `src/engine/schedule.ts`, which must name
every member of `ScheduledCause` (a missing one does not compile) and gives each its `run` and the
rule a stored cause of it can break (`invalid`, read by `validateSnapshot`). The response schema in
`src/contract.ts` repeats the stored shapes, and `tests/schedule.test.ts` holds the two in step.

**Running.** The clock runs causes as it passes their tick ([time.md](time.md)): at each tick with
something due, the modifiers due expire first, then the causes due run in schedule order, each
emitting under its `cause_id`.

**The self-closing door.** An openable with a positive `closes_after` prop is scheduled to close
that many ticks after an `open`: a door opened at tick 4 with `closes_after: 2` emits `closed` at 6,
during whichever command spans 6, caused by its `opened`. An open door is refused `already_open`, so
the count stands until it runs out; `close` by hand withdraws the pending close, and an `open` after that, or
after the author shut the door, starts a fresh count. Neither records anything about the withdrawal.

**Processes.** A template's processes run as a third kind, scheduled and withdrawn as the props that
govern them change ([processes.md](processes.md)).

**Beats.** The author's own interventions, `schedule_beat` and `cancel_beat`, are the fourth kind
([beats.md](beats.md)): a sound or an edit at a tick, with conditions, followers, or a repeat. A beat pruned with its
subject records nothing, and a beat with an unmet condition or a refused action emits `beat_skipped`.

**Bleeding.** A severed part opens a wound that bleeds a few times, each bleed scheduling the next
([bleeding.md](bleeding.md)).

**Overtaken causes.** A cause that finds nothing to do (the door already shut, say by an edit) is
taken off the schedule and emits nothing. A cause whose entity is removed goes with it, pruned once
the transition has run. Only a close touches more than its own entity, moving its gate's occupants.

**In the way.** A close moves everything standing on the gate's footprint aside first, agents and
items alike, just clear along its thin axis (a tie goes positive), each under a `moved` caused by
the `closed`, uncovering what it hid; what a walk would not meet stays (anything lower than
`STEP_OVER_CM`, broken or rubble). A door between rooms has no footprint, so a close there moves
nothing. `close` by hand does the same.

**Stored one way.** `validateSnapshot` refuses an empty list (`empty_schedule`), a cause not ahead
of the clock (`schedule_not_ahead`, since the clock runs everything due), causes out of due order
(`schedule_unordered`), a cause on a missing entity (`schedule_dangling`), an unknown kind
(`unknown_cause_kind`), a bleed with none left (`bleed_not_remaining`), and a process with no id
(`invalid_process`) or pending twice on one entity (`duplicate_process`), and a malformed beat
(`invalid_beat`), a beat id used twice (`duplicate_beat`) or more than 256 of them (`too_many_beats`). The schedule is not a
field of any entity, so like `tick` its changes are not deltas; the events are the record. Stored
worlds are `schema_version` 3 since.

`tests/schedule.test.ts` is the spec, with the pushed-aside gate in
`tests/scenario-cell.test.ts`. The property test's door and chest close themselves, so random
sequences schedule, withdraw, overtake and remove closes, and every step is validated.
