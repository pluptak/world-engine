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

1. [Power and remote control](#power-and-remote-control).

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

### Power and remote control

The lab's AI cannot lock a door from the server room (`docs/limits-lab.md`, D), and nothing is
powered (E). Two named links, each a prop naming one entity, give a door a controller and a power
supply; the openable verbs a body uses are the ones a controller uses, with reach, key and hands
replaced by the links. A remote command can fail, and says where.

- **Props** (`src/engine/fields.ts`): `power_source` (boolean, definition): an intact one supplies
  power. `powered_by` (id, state): the next link toward a source, a cable or the source itself.
  `controlled_by` (id, state): the next link toward the agent that controls this entity, a panel or
  the agent. Both ids may be written by the architect (`ARCHITECT_PROPS` in `forms.ts`).
- **Reading them**, `src/engine/power.ts`, pure:
  - `powered(snapshot, id)`: walk `powered_by` from the entity; every entity on the walk, the
    first included, is not `destroyed`, and the walk ends at a `power_source`. An entity with
    neither prop is unpowered.
  - `controller(snapshot, id)`: the agent the `controlled_by` walk ends at, or null.
  - `remoteFault(snapshot, actor, device)`: the first fault along the control walk from the device
    to the actor, the device included and the actor not: a link `destroyed` is `disconnected`, one
    whose `powered()` is false is `unpowered`, each with `{ at: <link id> }`; null when none.
- **Addressing:** `gropable` (`src/engine/query.ts`) also answers true for an entity whose
  `controller` is the actor, whatever the state of the links, so a fault is refused with its code,
  never `unresolved`. The terminal names the exit door; it still does not perceive it (cameras are
  the next item), and an actor's options list it.
- **Verbs** (`src/engine/verbs/openable.ts`): when `controller(target)` is the actor, `open`,
  `close`, `lock` and `unlock` skip reach, the key and `requires` (`manipulation`) and refuse
  `remoteFault`'s code instead, after `already_*` and `locked`; everything else, the transition,
  the scheduled close and moving occupants aside included, is unchanged. Any other actor, a human
  beside the door, acts on it as now, with no power needed: the lock is mechanical too.
  `disconnected` and `unpowered` join those four verbs' `refuses` and the registration points.
- **Snapshot rules** (`src/engine/validate.ts`): a `powered_by` or `controlled_by` naming no
  entity is `dangling_reference`, so `remove` of a link is refused; a walk that loops is
  `power_loop` or `control_loop` (`linkLoop`). Destroying a link keeps the entity, so the walk
  breaks and the fault names it.
- **Templates:** `generator` (`power_source`, heavy, in a room) and `cable` (small, light,
  `max_integrity` low enough that one human `attack` destroys it, no `break_products`).
- **Lab** (`scenarios/lab.json`): a generator in the server room, a cable in the corridor powered
  by it, the exit door `powered_by` the cable and `controlled_by` the terminal.
  `tests/scenario-lab.test.ts` step D becomes the terminal locking the exit door ok with no key; a
  new step after it has a subject destroy the cable, the terminal's `unlock` then `unpowered` with
  `{ at: cable }`, and ann's key still unlocking it by hand. Step E's `powered` line goes.
- **Tests:** `tests/remote.test.ts`, a small world of its own: remote lock, unlock, open and close
  ok with no key, hands or reach; a remote close moves an occupant aside; `unpowered` for a
  destroyed source and for a door with no `powered_by`; `disconnected` for a destroyed panel
  between door and agent; an agent the walk does not end at is `unresolved` from another room;
  `already_locked` before a fault; the actor view names the door by alias and lists it in
  options; the snapshot rules refuse a dangling link and a loop of each kind. `tests/fields.test.ts`
  and the property test's verb table if the new codes need them.
- **Docs:** new `docs/power.md` (the props, the two walks, the faults, what stays manual);
  `docs/relations.md` one row each for `props.powered_by` and `props.controlled_by` (split the file if it
  passes its cap); `docs/verbs-openables.md` one line; `docs/limits-lab.md` loses the remote-control
  and power lines and gains what the build shows (an agent's own power is not modelled: an
  unpowered terminal still senses and acts).
- **Depends on:** the lab item (built). **Not in it:** a human using a panel to act at a distance;
  switching a source off (it is cut by destroying it or a cable); power for anything but remote
  control (lights, cameras, the terminal itself); delays and partial failure; who may use a
  controller beyond the walk ending at them.
