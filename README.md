# world-engine

A deterministic world model for narrative and agent grounding: commands in; statuses, deltas and
events out, never prose. An in-process API (`createWorld`, `openWorld`, `memoryWorld`); a JSON CLI.

- **Verbs:** move, take, drop, put, give, pour, consume, push, pull, attack, open, close, lock, unlock, search,
  light, douse, say, wait, and the author's `edit` and `advance`; every refusal is a declared code with numbers, not text.
- **Bodies, physics:** parts, capacities, severable limbs; support and containment chains, falls, breaks, spills, as cause chains.
- **Perception:** four senses from one sense table, with concealment, `search` and speech; `perceivers` names who sensed each event.
- **Time:** one integer `tick`; beats, template processes and scheduled causes run on it, and seeded dice replay exactly.
- **Controllers:** `options` lists what an actor can try; `actorWorld` is one actor's sealed view of a world.
- **History:** a validated append-only store, `since`, `trace`, `beat`, stale commands preempted.
- **Authoring:** named scenarios, anchors, template `extends`, per-world templates and coverage.

`npm run check` is the gate (Node ≥ 20). Start: `docs/overview.md`; index: `docs/DESIGN.md`; limits: `docs/limits.md`.
