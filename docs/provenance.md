# Provenance

The event chain records where each change came from. It is provenance: it says which event led to
which, not every condition that made one happen, and there are no counterfactuals
([thesis.md](thesis.md)). The field keeps its name, `cause_id`, which the CLI contract and every
stored log carry.

**Events.** Every event has an `event_id` (`ev<n>`, from `next_seq`), the `command_id` of the
command it happened in, the `tick` it happened at ([time.md](time.md)), and one `cause_id`. An ok
command first emits its root event, named after its verb (`push`, `edit`, `wait`), with `cause_id:
null`; everything the command causes names an earlier event as its one parent. So the events form a
tree whose roots are commands, and a root id needs no field of its own: it is the end of the walk.

**Deltas.** Every delta names the event it happened under (`event_id`), so a field's current value
leads to an event too: `trace({ entity, field })` starts from the last delta of that field (an
entity's spawn for one never changed) and `trace({ event_id })` from an event. Both return the chain
root first.

**Across commands.** A parent need not be in the same command. When a modifier expires, during
whichever command spans its tick ([time.md](time.md)), its `capability_changed` names the event
that made the modifier, and the change to `modifiers` is recorded under that `capability_changed`.
A trace from the field or from the event therefore reaches the blow, not the step the stun ended
during; `command_id` and `tick` still say when it happened. A door that closes itself is the same:
its `closed` names the `opened` ([schedule.md](schedule.md)). Every chain ends at some command's
root.

**What has no events.** A refused, invalid, unresolved or preempted command changes nothing and
emits nothing. A stored world's `log.jsonl` keeps it with its status and reason code, but `since`
and `trace` read only ok commands, so an attempt that failed is not queryable through `World`.

What it does not do: an event has one parent, never several (`causes: [...]` waits for a scenario
that needs a conjunction), and nothing says which conditions were necessary or sufficient.
`checkCauseChain` in the property test walks every event in the history to a root.
