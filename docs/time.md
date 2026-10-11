# Time

The clock is the snapshot's integer `tick`: logical time, never the wall clock.
Every verb declares its `duration`: `{ticks}`, or `{arg}` for the count that
sets it. Every verb takes one tick, except `wait` and the author's `advance`
(`args.ticks`; `advance` is time with no agent acting), and `edit`, which takes none.

An ok command resolves at the tick it starts: its preconditions and transition read
the snapshot as it was given. Then the pipeline advances the clock (`advanceClock`
in `src/engine/clock.ts`) through every tick in that span that has something due,
and ends at start + duration. What falls due here is a modifier's expiry, processed
in tick, entity, capacity, cause and declaration order. Each
expiry emits `capability_changed` after the command's own events, caused by the event that made the
modifier, under which the change to `modifiers` is recorded too ([provenance.md](provenance.md)).

A refused, invalid, unresolved or preempted command takes no time, and neither does `check`. A
`beat` is an ordered batch, so its commands take their time in turn. A command that would carry the
clock past the largest safe integer is `invalid` with `clock_overflow`, an edit excepted.

Every event records its `tick`: the command's starting tick for the verb's own events, the tick it
fell due for an expiry, so a five-tick `wait` from tick 1 that ends a stun shows `wait` at 1 and
`capability_changed` at 3. Within a command, ticks never go back.

An attack's modifier expires three ticks after the tick of the blow, and the blow takes one of
them. `tests/clock.test.ts` is the spec.

The rest of what falls due is in [schedule.md](schedule.md). What time does not do: agents do not
act in parallel, and two commands in a beat never share a tick. A round's moves do share one
([rounds.md](rounds.md)).

**Waking early.** `advance` may end where one's senses reach, and
`wait` where its waiter's do; `ticks` stays the upper bound
([verbs-time.md](verbs-time.md)). Two advances that end where one
would have leave the same world. What was due later stays pending.

**A run's limit.** A running run's clock never passes its `tick_limit`
([run.md](run.md)).

**Stopping before a beat.** `advance` may end one tick before a beat
it names ([verbs-time.md](verbs-time.md), [schedule-api.md](schedule-api.md)).
