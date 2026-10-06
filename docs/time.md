# Time

The clock is the snapshot's integer `tick`: logical time, never the wall clock. Every verb declares
its `duration` in the catalog, either a fixed `{ticks}` or `{arg}`, the positive int argument that
sets it. Every verb takes one tick, except `wait`, which takes `args.ticks`, and `edit`, which takes
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
two commands in a beat never share a tick.
