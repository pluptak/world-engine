# Moving verbs

An agent moving itself, and moving what stands in a room. Walking rules are in
[walking.md](walking.md), footprints and what stops a push in [occupancy.md](occupancy.md).

- `move`: needs `moving`; `args.to` a position, `args.location` a room through an open door; refuses
  `blocked` and `out_of_bounds` ([walking.md](walking.md)); emits `moved`, carrying what it holds.
- `push`: shifts a target by `args.distance_cm` along `args.dir`, stopping short at the first
  footprint in its path ([occupancy.md](occupancy.md)); what stands on it rides along, and only a
  stop short jolts off what topples. It needs `moving`, and refuses what it cannot reach or lift,
  or `blocked` when it cannot move at all.
- `pull`: the same shift in the opposite direction.
