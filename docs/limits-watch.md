# Limits: the watch

What `scenarios/watch.json` (a gatehouse and a dark yard behind a door, a guard, a lantern, a scheduled
knock and failing lights) could not say, and what the engine does instead. One line per limit, with the
step that shows it: `S` is `tests/scenario-watch.test.ts`. Nothing here is a proposal.

- A sound names its source entity, not "whoever is nearest": the architect's knock is a `sounded` on the
  door, and a beat cannot aim at the person standing closest (S step A).
- The lights are a prop of the room, not of its sources: a beat that darkens the gatehouse cannot douse a
  flame, so a lit lantern keeps the room lit and the chain has to ask first (S steps B, C).
- A voice heard in the dark names nobody: the controller knows who spoke only because it issued the
  command, and a voice carries no identity of its own to mistake or disguise (S step C).
- Volume is a distance, not an intent: a whisper reaches within `NEAR_THRESHOLD_CM` of the speaker whoever
  the addressee is, so the one it is whispered to (`to`) hears it only by standing close, and a bystander
  who happens to stand as close hears it too (S step B).
- Sleep is not modelled: the one who is meant to be asleep hears the knock as anyone does (S step A).
