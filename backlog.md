# Backlog

The next steps. One item = one small block: plan it, build it, `npm run check`, review the diff,
commit. Each item keeps every invariant in AGENTS.md (determinism, pure core, `canonicalJson`, no
prose, coverage-governed `"unknown"`).

Delete an item when it ships — git history records it; DESIGN.md describes what is built.

**Scope line.** The engine is a library: a typed, in-process API through which a caller manipulates
objects, humans and animals and asks about the world. The CLI is one thin adapter over that API, and
there is no web server. Turning prose or intent into calls, and choosing calls that reach a desired
world state, is the job of a middleware that does not exist and is not part of this project. Items
below may make the API easier for such a caller to drive (describing its own commands, dry-running
one, structured refusals), but never interpret text or plan on a caller's behalf.

## D. What the API tells its caller

### 8. `trace` — the cause chain of an event or an entity's state
- **Scope:** `trace(event_id | {entity, field})` → the event chain back to the root command or edit
  (for a field: the event of the last delta that set it).
- **Done when:** trace(the room's `residue`) returns spawned/broken/dropped/displaced/moved/push.

### 11. Structured refusal data
- **Why:** `out_of_reach` alone does not say by how much; a caller must not have to recompute it.
- **Scope:** an optional `reason_data` beside `reason_code`:
  - `out_of_reach` → `{distance_cm, reach_cm}`;
  - `too_large` → `{item_cm, space_cm}`;
  - `container_closed` → `{enclosure}`;
  - `insufficient_capacity` → `{capacity, have, need}`.

  Data only, never prose.
- **Done when:** every refusal the verbs emit carries its data, and the contract schema types it.

### 12. A beat: several commands against one version
- **Why:** several agents can act at once.
- **Scope:** `beat(basedOn, commands[])`, applied in array order, each with the existing
  stale/`preempted` rule; one log line per command. Not atomic — each has its status.
- **Done when:** two takes of the same bottle in one beat → the first `ok`, the second `preempted`.

## E. Spatial vocabulary

### 13. Anchors: relation-first positions
- **Why:** worlds are easier to author as "by the door", "at the window" than in centimetres.
- **Scope:** an `anchor` template (no mass, no collision) and a `near: Id | null` field derived
  into `pos` when present; scenarios and `edit place` can use it. `fact(x, near, door)` joins
  coverage.
- **Done when:** a scenario authored with anchors only (no `pos`) runs the bottle chain unchanged.

### 14. `pour` and liquid transfer — optional
- **Scope:** liquid contents (`props.liquid_material/amount`) move into a container or become
  residue on a surface; partial amounts; emits `poured`.
- **Done when:** pour half a bottle into a cup → both amounts correct; onto the floor → residue.

### 15. Concealment: `under` / `behind` — optional
- **Scope:** a `concealed_by: Id | null` relation; sight of a concealed entity is `false` until the
  observer searches the concealer (a `search` verb).
- **Done when:** a file under a book is not seen; after `search book` it is.

## F. Authoring

### 16. Named ids in scenarios
- **Scope:** a scenario entry may carry `"id": "bottle"`; references use names. `createWorld` maps
  them to `e<n>` deterministically and returns the map.
- **Done when:** both shipped scenarios are rewritten without a single literal `e<n>`.

### 17. Template `extends`
- **Scope:** `"extends": "bottle"` merges parent fields (props shallow-merged, parts replaced only
  if declared); cycles rejected; the hash covers the resolved templates.
- **Done when:** `wine_bottle extends bottle` with only a changed `liquid_material` loads and breaks.

## G. Robustness

### 20. Seeded property tests, an event store, a benchmark
- **Scope:**
  - a test-only seeded PRNG generates random command and edit sequences, for humans and animals;
  - assert replay equality, no input mutation, cause chains that end at a root, and that
    `validateSnapshot` holds after each step;
  - append events to `<world>/events.jsonl` so queries stop replaying the whole log;
  - `scripts/bench.ts` runs 10k commands.
- **Done when:**
  - 500 sequences × 30 steps pass;
  - a planted bug (skip a delta) is caught;
  - event-store results are byte-identical to the replay path;
  - the benchmark number is in DESIGN.md.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`) and continuous physics
  (Rapier/Box2D): revisit only when a concrete world needs them.
