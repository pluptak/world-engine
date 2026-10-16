# Scheduled causes

Something the world does by itself, later. A snapshot's `schedule` lists
what is pending, ordered by due tick, absent when nothing is pending (`Schedule.cs`).

**Kinds.** Five: `close` ([verbs-openables.md](verbs-openables.md)),
`bleed` ([bleeding.md](bleeding.md)), `process`
([processes.md](processes.md)), `beat` ([beats.md](beats.md)), `outcome`
([sockets.md](sockets.md)). Each is a
record of `ScheduledCause` (`Model/Snapshot.cs`); `Schedule.Run` runs each kind, and
`SnapshotValidation` holds a stored one to its rules. The CLI's `schedule` op writes the
causes as the snapshot stores them, its `kind` first (`WorldJson`).

**Running.** The clock runs causes as it passes their tick
([time.md](time.md)): modifiers due expire first, then the causes
due run in schedule order, each emitting under its `cause_id`.

**Overtaken causes.** A cause that finds nothing to do (the door
already shut, say by an edit) is taken off the schedule and emits
nothing. A cause whose entity is removed goes with it, pruned once
the transition has run; an outcome goes with its item too. Only a close touches more than its own entity,
moving its gate's occupants.

**Stored one way.** `SnapshotValidation` refuses a schedule that is not
one stored form:
- empty (`empty_schedule`), not ahead of the clock
  (`schedule_not_ahead`), or out of due order (`schedule_unordered`).
- on a missing entity, or an outcome on a missing item or with no
  part (`schedule_dangling`). A cause of an unknown kind does not read
  at all.
- a bleed with none left (`bleed_not_remaining`).
- a process with no id (`invalid_process`), or pending twice on one
  entity (`duplicate_process`).
- a malformed beat (`invalid_beat`), a beat id used twice
  (`duplicate_beat`), or more than 256 (`too_many_beats`).
The schedule is not a field of any entity. Like `tick`, its changes are not deltas;
the events are the record. Stored worlds are `schema_version` 5.

The `validate` rows of `ProcessGoldenTests` and `BeatGoldenTests` and the schedule variants of
`SnapshotValidationTests` are the spec; the property traces cover schedule, withdraw, overtake,
remove. Pushed-aside gate: the cell script (`Block21ReplayTests`).
