# Conditions that wait, and watches

[beats.md](beats.md) describes scheduled beats. Two additions let one wait for several things, and
let a beat keep watch until its action has run.

**`all`.** `only_if: { all: [ ... ] }` holds when every one of its one to 16 single conditions
(the three forms in [beats.md](beats.md)) holds. The singles are not nested, so an `all` inside an
`all` is `invalid_args`. Each entry's entity or room must exist when the beat is scheduled,
`no_such_entity` otherwise, followers' included. A single condition on a missing entity is still
read false when due, as before; an `all` names what it reads up front, because one that is not
there is false for good.

**Watches.** `repeat: { every_ticks, times, until_ran: true }` makes a watch. While its condition
is false a run records nothing, not even `beat_skipped`, since a watch that finds nothing is not
news. The first run whose action ran (the condition held and the edit was not refused) ends it: it
is off the schedule and `times` no longer matters. A run whose edit is refused still emits
`beat_skipped { reason: "failed" }` and the watch goes on. `until_ran` is `true` or absent
(anything else is `invalid_args`).