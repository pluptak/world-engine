# The director's levers

The director steers through what the architect tied, and no more. A run's `pool`
holds beats with no tick: `play_beat { id, at_tick }` takes one out and queues it, caused by the
edit's event, once. `odds` names a door's `jam_pct` and the range a director may steer it within:
`steer { entity, prop, value }` sets the value in force (`run.steered`), and a remote command to
that door rolls against it in place of the template's, which is left as it was. Both are refused
`no_run` where the run has none; `no_such_pool_beat`, `beat_in_past` and `duplicate_beat` for a
play; `not_steerable` and `out_of_range` for a steer. A handle may `idle()`: it passes every round
until it submits again. `closeRounds({ max, stop_before? })` closes empty rounds, each logged as a
closed round by the director, while every live registered player is idle (`players_active`
otherwise). It stops after `max`, at one tick before the beat `stop_before` names, or at the first
round a registered body senses an event the round made (before or after it, `sensedBy`), so no
player sleeps through what reaches it.

Tests: `tests/director-levers.test.ts`.
