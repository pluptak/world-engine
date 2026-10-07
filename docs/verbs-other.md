# Other verbs

Striking, searching, lighting, waiting, and the author's edit and advance.

- `attack`: picks the first mode its attacker can use (fist, bite), with damage from the template; a
  bite across bars must fit their gap ([walking.md](walking.md)); a severed part opens a wound that
  bleeds ([bleeding.md](bleeding.md)); a lost part drops what it held, and a stunned victim keeps
  the rest.
- `search`: looks under or behind a target, with `manipulation` and in reach; one `found` per
  hidden thing names its concealer, nothing changes, and nothing records who looked.
- `light`: sets `burning` on a target with `light_source: true` under a `lit` event, with
  `manipulation` and in reach, one tick. It refuses `already_burning`, and `no_fuel` when the target
  declares a `fuel` of 0 or less, besides `not_a_light`, `target_attached` for a part,
  `container_closed` and `out_of_reach`. Whether a room is lit is read from what burns in it
  ([perception.md](perception.md)), and a light's burn is a template process
  ([processes.md](processes.md)): `templates/lantern.json` burns a point of fuel a tick and snuffs
  itself at 0, a `candle` is the same with less.
- `douse`: the same the other way, under a `doused` event; it refuses `not_burning` and the same
  four others.
- `wait`: takes `args.ticks` ticks and changes nothing else ([time.md](time.md)).
- `advance`: the same for the world author (`actor: "world"`), which has no body and so cannot
  `wait`: `args.ticks` ticks pass, and whatever falls due in them runs under its own cause, a wait's
  way. An agent issuing it is `invalid` with `invalid_author`, a missing or non-positive count
  `invalid_args`. Its own `advance` event is authored work nobody senses; what the clock runs is
  sensed as usual. It is the controller's way to move time without an agent waiting
  ([time.md](time.md)).
- `edit`: carries one `spawn`, `remove`, `place`, `set_props`, `set_part` or `set_seed` as `args.edit`
  (`set_seed` gives the world's dice a state, [rng.md](rng.md)), and
  refuses with the code of the first snapshot rule its result breaks ([relations.md](relations.md)).
  A `place` may write `pos` as `{anchor, dx, dy}` ([space.md](space.md)) and `concealed_by`, which
  hides the placed thing under or behind another in the same room.
