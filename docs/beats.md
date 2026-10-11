# Authored beats

An architect says "at tick 305 someone knocks at the door, at 310 the lights fail": the world does
it, without scripting any character. A *scheduled beat* is that intention kept in the snapshot's
schedule ([schedule.md](schedule.md)); when it falls due it becomes ordinary events, which every
observer senses as it would any others. (Not the `beat` of `World`, an ordered batch of commands.)
Mapping a tick to a wall-clock time such as 20:05 is the controller's job:
the engine knows ticks only.

**Authoring.** Two `edit` kinds, issued by the world author ([verbs-edit.md](verbs-edit.md)):

- `schedule_beat { id, at_tick, action, only_if?, then? }`. `id` is a token matching
  `^[A-Za-z0-9_.:-]{1,64}$`, unique among pending beats (`duplicate_beat`); `at_tick`
  must be ahead of the clock (`beat_in_past`), since the schedule only holds causes
  ahead of it. The beat's *subject* (below) must exist (`no_such_entity`, `invalid`). A
  malformed beat is `invalid_args`.
- A scene's beats are queued at creation with a null `cause_id`, as a process the
  initial state started ([scenario.md](scenario.md)); the `schedule_beat` edit is the
  only other way one is made.
- `cancel_beat { id }` withdraws a pending beat and everything it would have chained,
  recording nothing; an id nothing pending carries is `no_such_beat`. Only a beat on
  the schedule can be cancelled, not a follower that is not yet scheduled by its parent.
- `retime_beat { id, at_tick }` brings a pending beat forward or puts it back, keeping its action,
  condition, followers and cause; it runs after whatever is due at `at_tick`, as if scheduled then.
  `at_tick` must be ahead of the clock (`beat_in_past`), and an id nothing pending carries is
  `no_such_beat`. A repeating beat's next run moves; later runs keep `every_ticks` from there.

**Order.** The cause kind is `beat`: `{ due_tick, kind, entity, cause_id, id,
`action, only_if?, then? }`, where `cause_id` is the event the `schedule_beat` edit
emitted. Two beats due at one tick run in the order they were scheduled, and a long
`advance` runs a whole chain, each follower at its own tick.

**Stored one way.** `validateSnapshot` holds a stored beat to the shape `schedule_beat`
carries and to its own subject (`invalid_beat`), a unique id across beats and followers
(`duplicate_beat`), and the count (`too_many_beats`).

`tests/scheduled-beat.test.ts` is the spec. Property runs schedule, cancel and fire beats;
every step stays valid. What a beat does when it runs is in [beats-actions.md](beats-actions.md);
followers and repeats in [beats-chains.md](beats-chains.md).
