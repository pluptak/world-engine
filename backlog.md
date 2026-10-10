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

1. [A camera](#a-camera).

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

### A camera

The lab's AI locks the exit door blind and senses only its own room (`docs/limits-lab.md`, C and
D). A camera is a thing in a room whose sight is the sight of the agent its feed reaches, over
the same two links a door has: `controlled_by` toward that agent, `powered_by` toward a source.

- **Template and prop:** `camera` (definition, boolean) in `src/engine/fields.ts`;
  `templates/camera.json`, small and light, not an agent, `camera: true`. It is placed like any
  thing (no mounting, no height), and a human can see it, take it if it fits, or destroy it.
- **The feed:** a camera feeds the agent `controller(camera)` names (`src/engine/power.ts`) while
  the camera is not `destroyed` and `remoteFault(camera)` is null: it, and every link on to the
  agent, intact and powered. `feeds(snapshot, observer)` there lists those cameras, sorted by id.
- **Sight** (`perceive` in `src/engine/query.ts`): when the observer's own sight answers false at
  the location step (after `observer_destroyed`, `no_sense_capacity`, `abstract`, `authored`,
  `unseen`, `concealed` and `enclosed`, which a camera does not change), each feeding camera is
  tried as if the observer stood where it stands, its own room only and lit: the first that sees
  answers `true` / `camera`; none does, the body's own `false` stands. The observer still needs
  sight capacity of its own. Hearing, smell and touch never cross a camera.
- **What follows from `perceive`, unchanged:** `observe` and the actor view list what a camera
  shows, with its facts; `perceivers` name the fed agent under `sight`; `addressable` lets the
  agent name what it sees, and its own reach still refuses acting on it (`out_of_reach`);
  event-form sight reads the camera as it was before or after the event.
- **Lab** (`scenarios/lab.json`): a camera in the corridor, `powered_by` the cable and
  `controlled_by` the terminal. `tests/scenario-lab.test.ts`: in D the terminal sees the exit door
  and bob in the corridor, basis `camera`, and still nothing in the lab (C); in E, once the cable
  is cut, it sees neither.
- **Tests:** `tests/camera.test.ts`, a small world: a fed agent sees a thing in the camera's lit
  room (`camera`), not in a dark one, not a concealed or enclosed one, not one in the next room
  through an open door; no longer once the camera, its source or a link is destroyed; an agent
  the feed does not reach sees nothing; an observer with no sight capacity sees nothing through
  it; an act in the room lists the fed agent among `perceivers.sight`; the agent's `observe`
  and its actor view list the thing, and it can name it but not take it.
- **Docs:** new `docs/camera.md`; one line each in `docs/perception.md` and `docs/senses.md` for
  the basis `camera`; `docs/power.md` one line (a camera is a device too); `docs/limits-lab.md`
  updated (the door is no longer locked blind; what a camera does not do, as the build shows).
- **Depends on:** power and remote control (built). **Not in it:** sound through a camera, a
  view across a door, a cone or a facing, delay or recording, a camera moving or turning, a
  human watching a feed, and anything that tells a subject it is watched beyond seeing the camera.
