# Moving verbs

An agent moving itself, and moving what stands in a room. Walking rules are in
[walking.md](walking.md), footprints and what stops a push in [occupancy.md](occupancy.md).

- `move`: needs `moving`; `args.to` a position, `args.location` a room through an open door, or `args.through`
  a door of the agent's room, named like a target (`unresolved` or `ambiguous` as any name is), which takes it
  to the room on the other side: a shut one is `no_open_door`, anything but a door of its room
  `invalid_location`, and the landing is judged as for `location`. Exactly one of the three, else
  `invalid_args`. It refuses
  `blocked` and `out_of_bounds` ([walking.md](walking.md)), and `being_carried` (naming the carrier)
  for an agent held by another, which keeps its senses, speech and hands; emits `moved`, carrying
  what it holds, and uncovers what it or anything it carries was hiding. An agent standing on
  furniture steps down, checked only where it lands.
  `args.location` names only the agent's own room or one a door of it leads to, open or shut
  (`no_open_door`); any other id is `invalid_location`, as one that names no room, so a move cannot
  map the world.
- `push`: shifts a target by `args.distance_cm` along `args.dir`, stopping short at the first
  footprint in its path ([occupancy.md](occupancy.md)); what stands on it rides along, and only a
  stop short jolts off what topples. It needs `moving`, and refuses what it cannot reach or lift,
  `not_on_floor` (naming the support) for what does not stand on a room's floor, or `blocked`
  when it cannot move at all.
- `pull`: the same shift in the opposite direction.
