# Then: the run that reaches the bound

A process may declare `then`, once, for the run that brings the prop to the bound it was
moving toward (`min` for a negative `by`, `max` for a positive one, so a `then` with no
such bound is refused when the templates load). Exactly one of:

- `{ set_prop: { prop, value } }`: a second `changed` under the first, writing a prop of the entity
  (no `from` when the prop was absent). Writing the prop a condition reads is how a lantern
  snuffs itself: `edited` → `changed` (fuel 0) → `changed` (burning false).
- `{ damage: { amount } }`: takes integrity under a `damaged`, or a `destroyed` that sets the status
  when none is left and drops what the body held, each fall caused by the
  `destroyed`. It is the same function a bleed uses (`hurt` in `src/engine/harm.ts`), so a
  body that starves out reads like one that bled out.
- `{ remove: true }`: a `removed` under the run, the author's removal (`removeEntity` in
  `src/engine/verbs/edit.ts`): what it hid is uncovered and what it held or
  carried is let go. A room someone is in is not removed, as for the author, and the
  `then` does nothing. Whatever else was scheduled on a removed entity goes with it.
- `{ spent: true }`: the entity is used up, which is a removal that leaves what its template says it
  leaves (`spendEntity` in `src/resolvers/physical.ts`, [templates.md](templates.md)): a `spent`
  event under the run, then each of its `spent_products` spawned where it stood, every `spawned`
  caused by `spent`, its `spent_residue` added to the surface they went to, and the entity removed
  under `spent`. It stood on a support: they are set there; in a container: inside it; in an
  agent's grip or pocket: on the floor at the holder's feet, since a grip holds one item. A product
  too big for the container it was in is set beside it instead (where the container stands, in
  turn: the floor at its holder's feet, the support under it), so the clock never produces a
  snapshot it must refuse; the residue stays in the container. A template that leaves nothing only
  loses the entity, so `{ remove: true }` is for what is taken out of the world with no event of
  being used up. The shipped `candle` declares its own `burn` with this `then`, where `lantern`'s
  only sets `burning` false.

An entity that is destroyed runs no process: it is no longer reconciled, so a starved body's hunger
stays where it ended.
