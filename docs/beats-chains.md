# Followers and repeats

**Chains.** `then: [{ id, delay_ticks, action, only_if?, then? }]` are scheduled `delay_ticks`
(positive) after the parent *runs*, each caused by the first event the
parent's action wrote. A parent that is cancelled, skipped or pruned schedules none. A
follower whose subject is gone by then is not scheduled. Nesting is at most four levels,
the beat itself counted, and a world holds at most 256 beats, followers counted from the
moment their parent is scheduled (`too_many_beats`), so none can be made to schedule
without end. Ids share one namespace across a beat and its followers.

**Repeating.** `repeat: { every_ticks, times }` on a `schedule_beat` (`every_ticks` from 1,
`times` from 1 to 1000) makes the beat come round again `times` more times, `every_ticks`
apart. Whatever a run does (it sounds, its condition skips it, its edit is refused) the next
is scheduled that far on, with the same id and the same cause, one fewer run to come; the
stored cause carries the runs still to come and drops `repeat` on the last. It is one pending
beat and one id however many runs are left, so the bound and `duplicate_beat` are as before,
`cancel_beat` withdraws every run still to come, and a beat whose subject is gone ends there.
With `until_ran` it is a watch ([beats-watch.md](beats-watch.md)). A repeating beat has no
`then` (`invalid_args`): a run would schedule its followers' ids again while the last run's
were still pending, and ids share one namespace.
