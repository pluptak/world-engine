# Holding verbs

Taking, setting down, passing and eating things. Grips, pockets and what losing a part drops are in
[carrying.md](carrying.md); what fits between bars, refused `too_big_for_gap` by `take`, `put` and
`give`, is in [walking.md](walking.md).

- `take`: lifts a thing out of whatever holds it into a free grip ([carrying.md](carrying.md));
  taking oneself, or what holds one, is `circular_placement`.
- `drop`: sets down what a grip holds, at the actor's own position (a carried agent's is its
  carrier's), then resolves the fall.
- `put`: names `args.destination` and `args.relation` (`on` or `in`); it emits one `moved` and
  sets `support` or `contained_in`, never a position, which comes through the chain. Fit compares
  the longest dimensions, ignoring a container's contents; `in` needs `manipulation`, `on` does not.
  `in` the actor's own pocket stows a held item.
- `give`: hands a held thing to `args.destination`, another agent in reach, under `take`'s rules.
- `pour`: moves `args.amount` (all of it by default) of a carried liquid into a container's
  `liquid_*` props or onto residue; the model is in [liquids.md](liquids.md).
- `consume`: eats or drinks what the actor carries or reaches. A thing with a positive `nutrition`
  is eaten whole: a `consumed` event on it, then it is removed (`removed`, caused by `consumed`). One
  that also has a `portions` prop (a positive whole number) is eaten a portion at a time: each `consume`
  lowers hunger by `nutrition`, emits `consumed` with `{ nutrition, portions_left }`, and leaves the thing
  with one portion fewer; the last portion removes it as above. A `portions` that is anything else is
  `not_consumable`. A
  vessel holding a liquid and declaring `liquid_nutrition` (per 100 cm³, a whole number) gives up
  `args.amount` of it (all by default; more than it holds is `insufficient_liquid`, anything but a
  whole positive number `invalid_args`), and keeps the vessel, emptied of its material at 0 as a pour
  leaves it. Either lowers the actor's `hunger` prop, floored at 0, by what it gave, under the
  `consumed` event, and only if the actor declares one: bread does nothing for a body with no hunger,
  and is eaten all the same. It refuses `not_consumable` (nothing to eat, a liquid with no
  `liquid_nutrition`, a part), `container_closed`, `out_of_reach` (what is carried is in reach, a hand or
  a pocket), and `mouth_full` for a creature whose jaw holds anything but the thing eaten. It needs no
  capacity: a dog eats from the floor. `hunger` is rising by itself on `human_hungry`
  ([processes.md](processes.md)).
