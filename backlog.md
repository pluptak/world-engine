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

1. [The AI watches its arm](#the-ai-watches-its-arm).
2. [A panel a subject can use](#a-panel-a-subject-can-use).
3. [A camera that looks one way](#a-camera-that-looks-one-way).

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

### The AI watches its arm

The arm works blind: the lab room has no camera (`docs/limits-lab.md`, C), so the terminal drives
the arm without seeing what it takes. A second camera, on the same cable, is a scenario change and
nothing else, and shows what driving two bodies from one caller looks like.

- **Lab** (`scenarios/lab.json`): `lab_camera`, template `camera`, in the lab at (300, -300),
  `powered_by` the cable and `controlled_by` the terminal.
- **Steps that change** (`tests/scenario-lab.test.ts`): C, where ann's take in the lab reached ann
  alone and the terminal did not see the key, now has the terminal among the take's sight
  perceivers, basis `camera`; what C showed (an act out of every camera's sight reaches only who
  stands there) moves to the server room or wherever the build finds no camera, or is dropped from
  limits if nowhere is left. Any other step the camera changes is updated and named in the commit.
- **The arm test** gains the terminal's side: before the arm takes the key, the terminal sees it
  (`camera`); after, it sees the key in the arm's grip; once bob cuts the cable it sees neither,
  and the arm's drop is `unpowered` as now. The two views name the key by different aliases
  (`aliasOf(terminal, key)` and `aliasOf(arm, key)` differ), so the test drives the arm by name,
  as a caller holding both views must.
- **Docs:** `docs/limits-lab.md` (C rewritten; a new line: a caller driving the terminal and the
  arm sees one key under two aliases and matches them by name, which two keys of one name would
  defeat).
- **Depends on:** nothing. **Not in it:** any engine change; one alias across a controller's
  bodies (a decision for the maintainer, recorded only as a limit).

### A panel a subject can use

Only the terminal works the exit door from afar; a subject must stand at the door with the key.
The roadmap's devices have "local versus remote control, permissions": a panel is the local
control, and reaching it is the permission. The AI and a subject at the panel can then both work
the door, in turn, each command against the world as the last left it.

- **Prop and template:** `panel` (definition, boolean) in `src/engine/fields.ts`;
  `templates/panel.json`: 30×10×40, 3 kg, not an agent, `panel: true`.
- **A panel is a link** on a device's control walk (`controlled_by` from the device names the
  panel, the panel names the controller), so the controller works through it as through any link,
  and a destroyed or unpowered panel is `disconnected` / `unpowered` for the controller too.
- **Working a device at a panel** (`src/engine/verbs/openable.ts`): an actor that is not the
  controller, cannot reach the device, and reaches (`inReach`) an intact panel on the device's
  control walk works the device as the controller does: no reach to the device, key or hands, the
  fault taken on the walk from the device to that panel, the panel included, the rest of the walk
  to the controller not. An actor that can reach the device works it by hand as now. The nearest
  such panel on the walk (first from the device) is the one used.
- **Addressing:** `gropable` (`src/engine/query.ts`) and the name match in `src/engine/resolve.ts`
  also allow a device whose control walk passes through a panel the actor reaches, as they allow
  the controller; `options` then offers it. A helper beside `controller` in `src/engine/power.ts`
  (`panelFor(snapshot, device, actor)`: the panel used, or null) serves all three.
- **Lab** (`scenarios/lab.json`): a panel in the server room at (-300, 0), `powered_by` the
  generator, `controlled_by` the terminal; the exit door's `controlled_by` becomes the panel. A new
  test in `tests/scenario-lab.test.ts`: the terminal locks the exit door; ann opens the server
  door, stands at the panel and unlocks and opens the exit door through it with no key; the
  terminal closes and, after the shut, locks it again; ann destroys the panel and the terminal's
  `unlock` is `disconnected` `{ at: panel }`, while ann's own key still works by hand. The earlier
  steps keep their results (the walk now passes through a powered panel; any jam the seed moves is
  repinned and named in the commit).
- **Tests:** `tests/panel.test.ts`, a small world: a human at a panel opens, closes, locks and
  unlocks a door in another room with no key; out of the panel's reach the door is `unresolved`
  by name; a human beside the door works it by hand, with its key, even when a panel is near; an
  unpowered panel or a cut link between door and panel refuses the human `unpowered` /
  `disconnected`, a link beyond the panel does not; the controller works through the panel and is
  refused at a destroyed one; a jamming door jams a panel's command too (it is remote).
- **Docs:** new `docs/panel.md` and its `docs/DESIGN.md` line; `docs/power.md` one line (split if
  past its cap); `docs/verbs-openables.md` one line; `docs/limits-lab.md` (who may use the panel is
  whoever reaches it; the AI and a subject undo each other in turn).
- **Depends on:** nothing. **Not in it:** a keyed or locked panel, panels for cameras, intercoms
  or the arm, the AI seeing who stands at the panel beyond its cameras, priority between the
  controller and a panel.

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
