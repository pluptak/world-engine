# Time

The clock is the snapshot's integer `tick`: logical time, never the wall clock. Every verb declares
its `duration` in the catalog, either a fixed `{ticks}` or `{arg}`, the positive int argument that
sets it. Every verb takes one tick, except `wait` and the author's `advance`, which take `args.ticks`
(`advance` is time with no agent acting, so a controller can move the clock alone), and `edit`, which takes
none, because the author states facts and no time passes in the world for them.

An ok command resolves at the tick it starts: its preconditions and transition read the snapshot as
it was given. Then the pipeline advances the clock (`advanceClock` in `src/engine/clock.ts`) through
every tick in that span that has something due, and ends at start + duration. What falls due
today is a modifier's expiry, processed in tick, entity, capacity, cause and declaration order. Each
expiry emits `capability_changed` after the command's own events, caused by the event that made the
modifier, under which the change to `modifiers` is recorded too ([provenance.md](provenance.md)),
so a stun wears off during whichever command spans its tick, `wait` or not.

A refused, invalid, unresolved or preempted command takes no time, and neither does `check`. A
`beat` is an ordered batch, so its commands take their time in turn. A command that would carry the
clock past the largest safe integer is `invalid` with `clock_overflow`, an edit excepted.

Every event records its `tick`: the command's starting tick for the verb's own events, the tick it
fell due for an expiry, so a five-tick `wait` from tick 1 that ends a stun shows `wait` at 1 and
`capability_changed` at 3. Within a command, ticks never go back.

An attack's modifier expires three ticks after the tick of the blow, and the blow takes one of
them. `tests/clock.test.ts` is the spec; the property test checks every generated command's
duration and that nothing due inside it is left behind.

Modifiers are not all that falls due: a door can close itself ([schedule.md](schedule.md)), and at
a tick with both, the modifiers expire first. What it does not do: agents do not act in parallel;
two commands in a beat never share a tick. A round's moves do share one: they are decided against the
same world and take the round's tick, and the clock moves once at its close ([rounds.md](rounds.md)).

**Waking early.** `advance` may name agents (`stop_on_perceived`) and then ends at the first tick whose
events one of them could sense, after everything due at that tick has run; `ticks` is the upper bound
and the `advance` event's `advanced` the ticks that passed. What was due later stays pending
([verbs-other.md](verbs-other.md)). Two advances that end where one would have leave the same world.

**A run's limit.** A running run's clock never passes its `tick_limit`: a `wait` or `advance` that would is cut
at it, and the run ends there ([run.md](run.md)).

**Stopping before a beat.** `advance` may instead name a pending beat (`stop_before`) and end
one tick short of the tick it falls due, so the caller can run it, move it or drop it
([schedule-api.md](schedule-api.md)).

An agent's `wait` with `until: "sensed"` does the same for itself: it ends at the first tick its own senses
reach, so an idle character need not wait a tick at a time to learn of a knock as it falls.
