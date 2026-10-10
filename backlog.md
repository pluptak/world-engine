# Backlog

One item = one small block: plan it, build it, `npm run check`, review the diff, commit. Each item
keeps every invariant in AGENTS.md (determinism, pure core, `canonicalJson`, no prose,
coverage-governed `"unknown"`). Delete an item in the same commit that ships it — git history
records it; `docs/` describes what is built (index: `docs/DESIGN.md`).
Measurements and test results live in `docs/measurements.md`, not here; an item quotes a number only
when the item is about that number.

**Scope line.** The engine is a library: a typed, in-process API through which a caller manipulates
objects, humans and animals and asks about the world. The CLI is one thin adapter over that API, and
there is no web server. Turning prose or intent into calls, and choosing calls that reach a desired
world state, is the job of a middleware that does not exist and is not part of this project. Items
below may make the API easier for such a caller to drive (describing its own commands, dry-running
one, structured refusals), but never interpret text or plan on a caller's behalf.

## Priorities

Work top to bottom; take the first entry that is not blocked. Reorder here, nowhere else.

1. [A camera that looks one way](#a-camera-that-looks-one-way).

When nothing above is unblocked, stop and report. Gaps with no plan yet are in
[plans/candidates.md](plans/candidates.md); they are not work, and only the maintainer promotes one
to an item here.

## How the work runs

One item at a time on `main`. Sessions that run in parallel each work in their own git worktree and
commit only their own files. Additions to the shared registration points (`src/engine/verbs/index.ts`,
`src/errors.ts`, `src/contract.ts`, the verb table in `tests/property-gen.ts`, the `docs/verbs.md`
index, `CLAUDE.md`) are one line or one entry each, so parallel work conflicts at most trivially.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- Named coarse levels (`empty`/`half`/`full`, `fresh`/`stub`): the middleware translates them into the
  percentage and condition forms (`docs/forms.md`), unless several callers need them or they hold an
  invariant.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
- More than single-parent `extends`: several parents, trait bundles, categories nothing reads, and
  see-through barriers (`docs/templates.md`).
- `move` suggesting where to stand: a free spot within reach of each thing is a position chosen to reach
  something, which is planning; `suggest` lists ids, never positions.
- A `distance` query: facts are true, false or unknown, and positions are in every observation.
- The verbs `turn` (it needs a facing direction), `use` (too general), `throw` (it would deal impact damage
  to agents) and `bandage` (a bleed stops by its count).
- Pathfinding: a caller routes around a barrier in several moves. Agents acting in parallel: a `beat` is an
  ordered batch, and two commands never share a tick.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

Every item is ready now and names anything it leans on; the order is under Priorities.

### A camera that looks one way

A camera sees its whole room (`docs/camera.md`, `docs/limits-lab.md`, C), so nothing in the
corridor escapes the AI while the cable holds, and no subject can slip past along a blind wall.
A cone on the camera is the first facing the engine has, and the cheapest: it is a device's,
fixed by the author, and no body faces anywhere. Facing for bodies stays a candidate.

- **Props** (`src/engine/fields.ts`): `facing_deg` (state, integer 0 to 359: degrees counter-
  clockwise from +x, the room's own axes, `requires` camera) and `cone_deg` (definition, integer 1
  to 360, `requires` camera; absent is 360, the whole room as now). `facing_deg` is state so a
  scenario and the author set it; `cone_deg` is a template's, so a narrow camera is a template
  (`templates/narrow_camera.json`, extends `camera`, `cone_deg: 60`), as `shut_door` is.
- **The rule** (the camera loop in `perceive`, `src/engine/query.ts`): a camera with a `cone_deg`
  below 360 sees a subject only when the angle between its facing and the line from the camera's
  position to the subject's effective position (`effectivePos`) is at most `cone_deg / 2`, the edge
  included. A subject at the camera's own position, or with no position (an unpositioned door), is
  seen as now. For an event, the subject's position at the end read (before or after the command,
  as the event form already reads both). A camera with no `facing_deg` and a cone is a broken
  snapshot (`camera_without_facing`, `src/engine/validate.ts`), so the rule never guesses.
- **Arithmetic:** compare the dot product of the facing's unit vector and the offset against the
  offset's length times the cosine of half the cone. It is a query and writes nothing, so no
  float reaches the snapshot; `Math.cos`, `Math.sin` and `Math.hypot` of the same integers give
  the same answer every run. Facing and cone are integers so tests can sit exactly on an edge.
- **Nothing else changes:** no new basis (out of the cone the body's own answer stands, as with a
  camera in another room); `perceivers`, `observe` and the actor view follow `perceive`; hearing
  through an intercom is not directional.
- **Lab** (`scenarios/lab.json`): the corridor's camera becomes a `narrow_camera` with
  `facing_deg: 65`, toward the exit door. Every earlier step keeps its result (the exit door, bob
  at (200, 360) and the cable lie within 30 degrees of 65 from (-400, -400)); the builder checks
  each and names any that moves. A new step: a subject at (400, -300) in the corridor is not seen
  by the terminal, and seen once the author turns the camera to `facing_deg: 7`.
- **Tests:** `tests/camera-cone.test.ts`, a small world: a subject inside the cone seen, outside
  not; on the edge seen; at the camera's position seen; an unpositioned door seen; a carried thing
  read at its holder; a cone of 360 and a camera with none both the whole room; an event read at
  the subject's position before or after (a subject walking into the cone is seen doing it); a
  cone without a facing refused by the rule; the author's `update_props` turning it.
- **Docs:** `docs/camera.md` (the cone; split if past its cap), `docs/fields.md` if it lists
  props, `docs/limits-lab.md` (C: a camera now has a cone; what the build shows),
  `docs/limits.md` (sight has no facing: still true of bodies).
- **Depends on:** nothing; after the AI-watches-its-arm item if built after it (that camera keeps
  the whole lab room). **Not in it:** a camera the controller turns (no `turn` verb: out of
  scope), facing or a cone for bodies, distance limits, occlusion by things in the room, height.
