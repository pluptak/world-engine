# What a beat does

**Actions.** A closed set, data, never code:

- `{ kind: "sound", entity, loud? }` emits `sounded` on the entity
  (a knock, a bang, a bell), with data `{ loud }`.
- Any of the author's own edits, applied through the same edit transition at the due tick:
  `spawn`, `remove`, `place`, `set_props`, `update_props`, `set_part`. A power failure is
  `set_props` (or `update_props`, which keeps the room's other props) `lit: false` on a room, and
  every consequence of the edit is sensed as usual.
  `set_seed` and the beat edits are not actions.

The *subject* is the entity the action is about: a sound's `entity`, an edit's `target`, a spawn's
`location` (which a spawn beat must give). It is the cause's `entity`; a beat whose subject
is removed before it falls due is pruned with it, recording nothing.

**Sound.** `sounded` is a row of its own in [senses.md](senses.md): heard in the entity's room, and
next door only when `loud`; never seen (`false` / `unseen`, wherever the observer stands); no smell;
no touch.

**Conditions.** `only_if` is read at the due tick, in one of three forms told apart by keys (an
`all` of them is in [beats-watch.md](beats-watch.md)); a mix of forms, or none, is
`invalid_args`, and a stored one is held to the same shapes (`invalid_beat`):

- `{ entity, prop, op, value }` (`op`: `eq ne lt lte gt gte`; orderings need a number)
  against the entity's `props`. A missing entity or prop is false.
- `{ entity, in: <room> }` is true when the entity exists and its `location` is that
  room, so a thing carried into another room is there with its carrier.
- `{ room, occupied: <boolean> }` is true when a live agent in the room is what `occupied` says:
  a destroyed or bled-out body and a severed part are not live. A missing room is false
  for both values.

When false the beat does nothing and emits `beat_skipped { id, reason: "condition" }`.

**Failure.** If the action's edit is refused when it runs, by its own checks or the
snapshot rule it would break, nothing it did is kept and the beat emits
`beat_skipped { id, reason: "failed", code }` with the refusal's code.
`beat_skipped` is authored work: nobody senses it.

A `set_props` or `update_props` whose prop its subject's template does not declare, or declares with
another type, is refused when scheduled with that rule's code (`undeclared_prop`,
`wrong_prop_type`), follower included; a scene's beat fails `invalid_scenario` the same way.
