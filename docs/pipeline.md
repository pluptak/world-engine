# Transition pipeline and verbs

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events, and return a status, deltas, and events chained by command and cause ID. Non-ok
results leave the snapshot unchanged; a success bumps its version, and a verb may declare
`validateResult`, run after its transition: it refuses a result that breaks an invariant. The engine
is pure: a transition takes a snapshot and returns a new one; I/O stays outside.

Each verb declares its args, the capacities it needs and the refusal codes it can return; `verbs()`
is the catalog read from those declarations, and a refusal with an undeclared code is an engine bug
that throws. Only an agent holds: agency is the template's `agent` prop, withheld from a detached
part. A surface declares `surface`, sized by its footprint; a container declares `container` and
`inner_*_cm`.

- `move`: needs `moving`; `args.to` is a position, `args.location` a room reached through an open
  door; it emits `moved`, and what it carries moves rooms with it.
- `take`: lifts a thing out of whatever holds it; `manipulation` scaled by the item's
  `hands_required`, or `mouth_carry` within `carry_limit_g` — one item at a time, never two-handed.
- `drop`: sets down what the actor carries, at the actor's own position, then resolves the fall.
- `put`: names `args.destination` and `args.relation` (`on` or `in`); it emits one `moved` and
  sets `support` or `contained_in`, never a position, which comes through the chain. Fit compares
  the longest dimensions, ignoring a container's contents; `in` needs `manipulation`, `on` does not.
- `give`: hands a carried thing to `args.destination`, another agent in reach, under `take`'s rules.
- `push`: shifts a target by `args.distance_cm` along `args.dir`, then support loss runs; it needs
  `moving`, and refuses what it cannot reach or lift.
- `pull`: the same shift in the opposite direction.
- `attack`: picks the first mode its attacker can use (fist, bite), with damage from the template;
  a victim that structurally loses the capacity holding something drops it, a stunned one keeps it.
- `open`: sets `open` on a target that declares `openable`, as a `props` delta under an `opened`
  event; a locked target is refused `locked`. A door joins two rooms through its `from` and `to`
  props and is in reach and in view from either.
- `close`: sets that prop false under `closed`; a shut container hides its chain, so `take` and
  `put` refuse `container_closed` and sight inside is `false`.
- `lock`: sets `locked` under a `locked` event; needs `manipulation` and a carried entity whose
  `opens` is the target's id, else `no_key`.
- `unlock`: the same requirement, clearing `locked` under `unlocked`.
- `wait`: advances `args.ticks` ticks and expires every modifier due in that span, in tick order.
- `edit`: carries one `spawn`, `remove`, `place`, `set_props` or `set_part` as `args.edit`, and
  refuses the code of the first snapshot rule its result breaks, so every relation rule in
  [relations.md](relations.md) is a code this verb can return.
