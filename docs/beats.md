# Authored beats

An architect says "at tick 305 someone knocks at the door, at 310 the lights fail" and the world does
it, without scripting any character. A *scheduled beat* is that intention kept in the snapshot's
schedule ([schedule.md](schedule.md)); when it falls due it becomes ordinary events, which every
observer senses as it would any others. (Not the `beat` of `World`, an ordered batch of commands.)
Mapping a tick to a wall-clock time such as 20:05 is the controller's job: the engine knows ticks only.

**Authoring.** Two `edit` kinds, issued by the world author like the rest ([verbs-other.md](verbs-other.md)):

- `schedule_beat { id, at_tick, action, only_if?, then? }`. `id` is a token matching
  `^[A-Za-z0-9_.:-]{1,64}$`, unique among pending beats (`duplicate_beat`); `at_tick` must be ahead of
  the clock (`beat_in_past`), since the schedule only holds causes ahead of it. The beat's *subject*
  (below) must exist (`no_such_entity`, `invalid`). A malformed beat is `invalid_args`.
- `cancel_beat { id }` withdraws a pending beat and everything it would have chained, recording
  nothing; an id nothing pending carries is `no_such_beat`. Only a beat that is on the schedule can be
  cancelled, not a follower that is not yet scheduled by its parent.

**Actions.** A closed set, data, never code:

- `{ kind: "sound", entity, loud? }` emits `sounded` on the entity (a knock, a bang, a bell), with data
  `{ loud }`.
- Any of the author's own edits, applied through the same edit transition at the due tick:
  `spawn`, `remove`, `place`, `set_props`, `set_part`. A power failure is `set_props` `lit: false` on a
  room, and every consequence of the edit is sensed as usual (the edit's own events are the author's,
  which nobody senses). `set_seed` and the beat edits are not actions.

The *subject* is the entity the action is about: a sound's `entity`, an edit's `target`, a spawn's
`location` (which a spawn beat must give). It is the cause's `entity`; a beat whose subject is removed
before it falls due is pruned with it, as every cause is, recording nothing.

**Sound.** `sounded` is a row of its own in [senses.md](senses.md): heard in the entity's room, and
next door only when `loud`; never seen (`false` / `unseen`, wherever the observer stands); no smell;
no touch.

**Conditions.** `only_if { entity, prop, op, value }` (`op`: `eq ne lt lte gt gte`; the orderings need
a number) is read against the entity's `props` at the due tick. A missing entity or prop is false. When
false the beat does nothing and emits `beat_skipped { id, reason: "condition" }`.

**Failure.** If the action's edit is refused when it runs, by its own checks or by the snapshot rule it
would break, nothing it did is kept and the beat emits `beat_skipped { id, reason: "failed", code }`
with the refusal's code. `beat_skipped` is authored work: nobody senses it.

**Chains.** `then: [{ id, delay_ticks, action, only_if?, then? }]` are scheduled `delay_ticks`
(positive) after the parent *runs*, each caused by the first event the parent's action wrote. A parent
that is cancelled, skipped or pruned schedules none. A follower whose subject is gone by then is not
scheduled. Nesting is at most four levels, the beat itself counted, and a world holds at most 256 beats,
followers counted from the moment their parent is scheduled (`too_many_beats`), so none can be made to
schedule without end. Ids share one namespace across a beat and its followers.

**Repeating.** `repeat: { every_ticks, times }` on a `schedule_beat` (`every_ticks` from 1, `times` from 1 to
1000) makes the beat come round again `times` more times, `every_ticks` apart. Whatever a run does (it
sounds, its condition skips it, its edit is refused) the next is scheduled that far on, with the same id
and the same cause, one fewer run to come; the stored cause carries the runs still to come and drops
`repeat` on the last. It is one pending beat and one id however many runs are left, so the bound and
`duplicate_beat` are as before, `cancel_beat` withdraws every run still to come, and a beat whose
subject is gone ends there. A repeating beat has no `then` (`invalid_args`): a run would schedule its
followers' ids again while the last run's were still pending, and ids share one namespace.

**Order.** The cause kind is `beat`: `{ due_tick, kind, entity, cause_id, id, action, only_if?, then? }`,
where `cause_id` is the event the `schedule_beat` edit emitted. Two beats due at one tick run in the
order they were scheduled, and a long `advance` runs a whole chain, each follower at its own tick.

**Stored one way.** `validateSnapshot` holds a stored beat to the shape `schedule_beat` carries and to
its own subject (`invalid_beat`), a unique id across beats and followers (`duplicate_beat`), and the
count (`too_many_beats`).

`tests/scheduled-beat.test.ts` is the spec. The property test schedules, cancels and fires beats, and every step
stays valid.
