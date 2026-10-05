# Verbs

Only an agent holds: agency is the template's `agent` prop, withheld from a detached part, and an
abstract template ([space.md](space.md)) is no target for an agent's verb. A surface declares
`surface`, sized by its footprint; a container declares `container` and `inner_*_cm`.

- `move`: needs `moving`; `args.to` is a position, `args.location` a room reached through an open
  door; it emits `moved`, and what it carries moves rooms with it.
- `take`: lifts a thing out of whatever holds it into a free grip ([carrying.md](carrying.md)).
- `drop`: sets down what a grip holds, at the actor's own position, then resolves the fall.
- `put`: names `args.destination` and `args.relation` (`on` or `in`); it emits one `moved` and
  sets `support` or `contained_in`, never a position, which comes through the chain. Fit compares
  the longest dimensions, ignoring a container's contents; `in` needs `manipulation`, `on` does not.
  `in` the actor's own pocket stows a held item.
- `give`: hands a held thing to `args.destination`, another agent in reach, under `take`'s rules.
- `pour`: moves `args.amount` (all of it by default) of a carried liquid into a container's
  `liquid_*` props or onto residue; the model is in [liquids.md](liquids.md).
- `push`: shifts a target by `args.distance_cm` along `args.dir`, then support loss runs; it needs
  `moving`, and refuses what it cannot reach or lift.
- `pull`: the same shift in the opposite direction.
- `attack`: picks the first mode its attacker can use (fist, bite), with damage from the template;
  a lost part drops what it held, and a stunned victim keeps the rest.
- `open`: sets `open` on a target that declares `openable`, as a `props` delta under an `opened`
  event; a locked target is refused `locked`. A door joins two rooms through its `from` and `to`
  props and is in reach and in view from either.
- `close`: sets that prop false under `closed`; a shut container hides its chain, so `take` and
  `put` refuse `container_closed` and sight inside is `false`.
- `lock`: sets `locked` under a `locked` event; needs `manipulation` and a carried entity whose
  `opens` is the target's id, else `no_key`.
- `unlock`: the same requirement, clearing `locked` under `unlocked`.
- `wait`: advances `args.ticks` ticks and expires every modifier due in that span, in tick order.
- `search`: looks under or behind a target; it needs `manipulation` and reach, emits one `found`
  event per hidden thing naming its concealer (none if it hides nothing), and changes nothing —
  who looked and what they were told is the caller's business ([relations.md](relations.md)).
- `edit`: carries one `spawn`, `remove`, `place`, `set_props` or `set_part` as `args.edit`, and
  refuses with the code of the first snapshot rule its result breaks ([relations.md](relations.md)).
  A `place` may write `pos` as `{anchor, dx, dy}`, which resolves to the anchor's position and its
  room and records nothing of the anchor ([space.md](space.md)), and may write `concealed_by`, which
  hides the placed thing under or behind another in the same room.
