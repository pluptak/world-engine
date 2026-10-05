# world-engine

A deterministic, causal world-transition library: commands go in; statuses, deltas and events come
out, never prose. An in-process API (`createWorld`, `openWorld`, `memoryWorld`); the CLI is JSON.

- **Verbs:** move, take, drop, put, give, pour, push, pull, attack, open, close, lock, unlock,
  search, wait, and the author's `edit`; every refusal is a declared code with numbers, not text.
- **Bodies:** parts, capacities, severable limbs; a hand or jaw holds one thing, a pocket what fits.
- **Physics:** support and containment chains, falls, breaks, spills and residue, as cause chains.
- **Perception:** sight, hearing, touch and smell (where coverage declares it) from one sense table, with concealment, `search`
  and silent hand acts; `perceivers` names who sensed each event, and what anyone knows is yours.
- **History:** a validated append-only store, `since`, `trace`, `beat`, stale commands preempted.
- **Authoring:** named scenarios, anchors, template `extends`, per-world templates and coverage.

`npm run check` is the gate (Node ≥ 20). Start: `docs/overview.md`; index: `docs/DESIGN.md`; limits: `docs/limits.md`.
