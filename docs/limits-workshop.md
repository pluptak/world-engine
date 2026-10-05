# Limits: the workshop

What `scenarios/workshop.json` and the occupancy, impact and landing it drove could not say, and
what the engine does instead. One line per limit, with the test that shows it: `W` is
`tests/scenario-workshop.test.ts`, `O` occupancy, `I` impact, `L` landing, `P` projection, `B`
the bottle scenario. Nothing here is a proposal.

- A footprint has no height: a stone pushed at a table stops at its edge rather than passing
  under it (O "no height").
- Rubble is solid: a broken bottle blocks the next push exactly as the whole one did, and a
  glass shard is an obstacle like any other footprint (W "rubble").
- Impact breaks or does nothing: it is the mover's mass times the distance it travelled against
  `break_fall_cm`, so a struck agent, chair or bench takes no harm (W "struck agent", I).
- A push has no speed: a longer run-up hits harder, a stone breaks the bottle from 13 cm and not
  from 12, and any stop short jolts off everything that topples, however gentle (I, B).
- A drop falls from the holder's centre: to drop the cup on the bench, ann stands inside the
  bench's footprint (W "dropped over the bench").
- Nothing on a surface has a position of its own: a cup that lands on a bench sits at its centre,
  and a pushed bench carries all it holds, with nothing sliding (L "stool", W "short push").
- Only physics sweeps: an agent's `move` is a destination, not a path, so ann may stand at the
  bench's centre (W "own move").
- An entity is never heard: a projection lists nothing by hearing, because the entity form of
  hearing answers for everything in the room, a hidden note included (P).
