# Overview

**Problem.** A story, game or agent needs a scene whose facts do not drift: where the bottle is,
what broke, who could have seen it. The engine keeps that state and answers with codes, never prose.
**For** a caller that turns intent into commands, such as a game loop, interactive fiction or an
LLM agent that must be grounded in what is true. The caller owns knowledge, language and luck.

**One example**, `scenarios/bottle.json` (`e2` table, `e3` bottle, `e4` pusher, `e5` stone):

```bash
npm run world -- init data/w1 scenarios/bottle.json
echo '{"op":"command","world":"data/w1","command":{"command_id":"c1","actor":"e4",
  "verb":"push","target":"e2","args":{"dir":"+x","distance_cm":200}}}' | npm run world --silent
```

The table slides 29 cm and stops at the stone, and the response chains the consequences by
`cause_id`: `push` → `moved` → `collided` → `displaced` → `dropped` (the bottle falls 75 cm) →
`broken` → three `spawned` shards, with a delta per field and the wine now residue on the room.
Nothing says "the bottle shatters"; a caller reads the codes. `trace` walks the chain back.

**Three-valued answers.** `fact` and `perceive` return `"true"`, `"false"` or `"unknown"`. Unknown
means the world's coverage does not declare that category, not that the engine failed. By default
only sight and hearing are covered, so `fact smell` answers `unknown` until a world declares smell.
A caller should treat it as "not modelled here" and decide whether to assume, ask or skip.

**Shapes worth knowing.** Templates are data: `human.hand_l` is a detachable part's companion, and a
template may `extends` another (`wine_bottle` extends `bottle`). Actions check capacities such as
`manipulation`, never parts, so a severed hand changes what an agent can do with no special case.

**Scale and non-goals.** Built for room-sized scenes (tens of entities; geometry is pairwise, there
is no spatial index) at about 3.6 ms per command. There is no randomness: damage and impact are
fixed arithmetic, and a caller who wants luck injects it as a different command. A `beat` is an
ordered batch, not simultaneous action ([limits.md](limits.md)). What is out of scope is in
`backlog.md`.
