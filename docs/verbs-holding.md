# Holding verbs

Taking, setting down and passing things. Grips, pockets and what losing a part drops are in
[carrying.md](carrying.md); what fits between bars, refused `too_big_for_gap` by `take`, `put` and
`give`, is in [walking.md](walking.md).

- `take`: lifts a thing out of whatever holds it into a free grip ([carrying.md](carrying.md)).
- `drop`: sets down what a grip holds, at the actor's own position, then resolves the fall.
- `put`: names `args.destination` and `args.relation` (`on` or `in`); it emits one `moved` and
  sets `support` or `contained_in`, never a position, which comes through the chain. Fit compares
  the longest dimensions, ignoring a container's contents; `in` needs `manipulation`, `on` does not.
  `in` the actor's own pocket stows a held item.
- `give`: hands a held thing to `args.destination`, another agent in reach, under `take`'s rules.
- `pour`: moves `args.amount` (all of it by default) of a carried liquid into a container's
  `liquid_*` props or onto residue; the model is in [liquids.md](liquids.md).
