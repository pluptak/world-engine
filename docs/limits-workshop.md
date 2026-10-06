# Limits: the workshop

What `scenarios/workshop.json` and the occupancy, impact and landing it drove could not say, and
what the engine does instead. One line per limit, with the test that shows it: `W` is
`tests/scenario-workshop.test.ts`, `O` occupancy, `I` impact, `L` landing, `P` projection, `B`
the bottle scenario. Nothing here is a proposal.

- A footprint has no height: a stone pushed at a table stops at its edge rather than passing
  under it (O "no height").
- Rubble is all or nothing: whatever has broken never blocks, whatever its size, and a template
  is debris or not, with nothing about how a pushed thing rides over it (W "rubble").
- Impact breaks or does nothing: it is the mover's mass times the distance it travelled against
  `break_fall_cm`, so a struck agent, chair or bench takes no harm (W "struck agent", I).
- A push has no speed: a longer run-up hits harder, a stone breaks the bottle from 13 cm and not
  from 12, and any stop short jolts off everything that topples, however gentle (I, B).
- A drop falls from the holder's centre, and a walking agent cannot stand over a table, so it
  drops at its feet and sets the cup on the bench with `put` (W "dropped beside the bench").
- Nothing on a surface has a position of its own: a cup that lands on a bench sits at its centre,
  and a pushed bench carries all it holds, with nothing sliding (L "stool", W "short push").
- An entity is never heard: a projection lists nothing by hearing, because the entity form of
  hearing answers for everything in the room, a hidden note included (P).
