# Waiting and moving time

- `wait`: takes `args.ticks` ticks. Changes nothing else
  ([time.md](time.md)).
  - With `until: "sensed"` (the only value; else `invalid_args`),
    `ticks` is an upper bound. The clock ends at the first tick
    whose events the waiter itself could sense.
  - The `wait` event says `{ advanced: n }`: the ticks that passed.
- `advance`: the same for the world author (`actor: "world"`).
  - An agent issuing it is `invalid` (`invalid_author`).
  - A missing or non-positive count is `invalid_args`.
  - Its own event is authored work nobody senses.
  - What the clock runs is sensed as usual.
  - With `stop_on_perceived`, a non-empty list of agent ids,
    `ticks` is only an upper bound. The clock ends where one's
    senses reach, after everything due then has run
    ([time.md](time.md)).
  - A listed id that is no agent is `invalid` (`no_such_actor`).
  - A destroyed body is `observer_destroyed`.
  - Anything but a list of ids is `invalid_args`.
  - `clock_overflow` is judged on the upper bound.
  - The `advance` event says `{ advanced: n }` too.
  - With `stop_before`, a pending beat's id, the clock ends one
    tick before the beat falls due. The beat stays pending.
  - A beat due at the very next tick is `beat_not_ahead`.
  - An id nothing pending carries is `no_such_beat`.
  - Both are refused, taking no time.
  - An id that is not a token is `invalid_args`.
  - Once that beat has run, nothing stops the clock.
  - A repeat's later run does not stop it either.
