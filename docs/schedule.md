# Scheduled causes

Something the world does by itself, later: a self-closing door, and a wound that bleeds. A
snapshot's `schedule` lists what is pending, each cause with its `due_tick`, `kind` (`close` or
`bleed`), `entity` and `cause_id`, the event that set it going; a bleed also carries `remaining`. It
is ordered by due tick, then by when each was scheduled, and absent when nothing is pending, so a
world that never schedules anything stores nothing for it (`src/engine/schedule.ts`).

**Running.** The clock runs causes as it passes their tick ([time.md](time.md)): at each tick with
something due, the modifiers due expire first, then the causes due run in schedule order, each
emitting under its `cause_id`.

**The self-closing door.** An openable with a positive `closes_after` prop is scheduled to close
that many ticks after an `open`: a door opened at tick 4 with `closes_after: 2` emits `closed` at 6,
during whichever command spans 6, caused by its `opened`. Opening it again starts the count over,
and `close` by hand withdraws the pending close; neither records anything about the withdrawal.

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
(`unknown_cause_kind`) and a bleed with none left (`bleed_not_remaining`). The schedule is not a
field of any entity, so like `tick` its changes are not deltas; the events are the record. Stored
worlds are `schema_version` 3 since.

`tests/schedule.test.ts` is the spec, with the pushed-aside gate in
`tests/scenario-cell.test.ts`. The property test's door and chest close themselves, so random
sequences schedule, withdraw, overtake and remove closes, and every step is validated.
