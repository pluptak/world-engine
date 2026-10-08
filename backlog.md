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

1. Presets, field tiers and roles: [plans/presets-and-roles.md](plans/presets-and-roles.md),
   blocks 3–8 in its order. Its open questions must be settled before block 4.
2. [Names that are Object members are not ids, templates or names](#names-that-are-object-members-are-not-ids-templates-or-names).
3. Candidates without a plan yet (below): write the item, then build it.

## How the work runs

One item at a time on `main`. Sessions that run in parallel each work in their own git worktree and
commit only their own files. Additions to the shared registration points (`src/engine/verbs/index.ts`,
`src/errors.ts`, `src/contract.ts`, the verb table in `tests/property-gen.ts`, the `docs/verbs.md`
index, `CLAUDE.md`) are one line or one entry each, so parallel work conflicts at most trivially.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
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
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed under candidates.

## Items

Every item is ready now and names anything it leans on; the order is under Priorities.

### Names that are Object members are not ids, templates or names

The entity map, the template registry and a world's names are plain objects, so an id, template or name spelt
`__proto__`, `constructor`, `toString`, `hasOwnProperty` or `valueOf` finds a member of `Object.prototype` where the
code asks `=== undefined`. Probing every id-taking input with those five found, from requests the CLI's schema accepts:

- A template of that name is believed. `edit spawn` with `template: "constructor"`, or a scenario entry with it,
  succeeds and stores an entity of that template; from then on `observe` and `options` throw `TypeError` for the whole
  world, and the log keeps the edit for good. (`edit` answers `unknown_template` to a name that is merely absent.)
- An actor, observer or support of that name is believed. A command with such an actor, `observe`, `inspect` and
  `options` with such an observer, the perceive query with such an observer, and `edit place` with such a support
  throw `TypeError`, which the CLI answers `internal_error`.
- `entity("constructor")` and `id("constructor")` return a function, `id("__proto__")` an object, and
  `actorWorld(world, "constructor")` is built. A scenario entry whose id is `__proto__` is refused `invalid_snapshot`,
  which names nothing.

- **Lookups:** an own-property read (`own(record, key)`, in `src/model.ts`) wherever a string from outside indexes
  `entities`, the registry or the names: the actor test in `src/engine/pipeline.ts`, the id match in
  `src/engine/resolve.ts`, `observe`, `inspect`, `options` and `entity` in `src/api.ts` and `src/engine/projection.ts`,
  the actor check in `src/actor-world.ts`, the id lookups of `src/engine/verbs/edit.ts` and `src/engine/query.ts`, the
  template lookups of `src/engine/spawn.ts` (which a scenario goes through) and `edit.ts`, and `World.id`. An id that is in the
  snapshot already keeps its plain read. A world's names are read with `Object.hasOwn` too, so `__proto__` is a name
  like any other.
- **Last gate:** `validateSnapshot` refuses an entity whose template is not an own key of the registry (a new rule and
  code, `unknown_template`), so what the lookups miss never reaches a stored world, and `verify` and a hand-edited
  world meet it.
- **Outcome:** such a name gets exactly what an id like `e999999` gets in the same place (`unresolved`, `invalid`,
  `no_such_entity`, `unknown_template`, a null, whichever that place gives), and the world is unchanged afterwards.
- **Tests** (`tests/object-names.test.ts`): each of the five at each place above and the others the probe covered
  (a target and its part, `give` and `put` destinations, `move`'s `location` and `through`, `take`'s `part`, `trace`
  and every query form), compared with `e999999` by status, reason code or error code; a spawn and a scenario of each
  template are refused and leave the world observable; `entity` and `id` answer null; a scenario that names an entity
  `__proto__` or `constructor` builds a world whose `id()` returns it; the CLI answers none of them `internal_error`.
  `tests/property-gen.ts` also draws these names where it draws an unknown id (`e999`).
- **Docs:** `docs/api.md` (ids are `e<N>`; a name or template is looked up by its own keys), `docs/state.md`
  (the new `validateSnapshot` rule).
- **Depends on:** nothing.

## Candidates

Known gaps with no plan yet. Promote one by writing it up as an item above.

- **Actors learn that unseen others acted.** `observation.version` and a `preempted` status reveal
  commands the actor could not perceive, through `actorWorld` and the `actor_*` ops; the open decision
  is whether an actor view should hide them.
- **Where to stand.** `move` is never ready or blocked in `options`, since its destination is free, so both runs
  from inside worked a spot out of inspected footprints (the guard's three candidates, the cell's 18 cm,
  `docs/limits-actor.md`). A `suggest` for `move` could list, for each thing the actor can name, a free spot within
  reach of it. Open: how many per thing (the nearest, or one per side), and whether coordinates are still
  describing a command or already planning one (`give`, `put` and `move` suggest ids, never positions).
- **`reachable` is arm's reach, doors are worked from further.** `inspect`'s `reachable` and the fact use `inReach`;
  `open`, `close`, `lock` and `unlock` also take a doorway of the actor's room from anywhere in it, and a door of
  the next room from its far side (`reachedAsDoor`), so a door can read `reachable: false` with `open` ready. Open:
  say so in `docs/perception.md`, or answer a doorway by the rule its verbs apply, which would make `attack` and
  `push` on it disagree instead.
- **Long-lived processes keep every file they read.** The parsed lines of `events.jsonl` and `deltas.jsonl`
  (`lineCaches`) and the head of `initial.json` (`initialMeta`) are module-level maps keyed by path with no eviction,
  so a process that opens many worlds, as a middleware in-process would, holds all their events until it ends. The
  CLI, one process per request, never does. Open: a bound by files or by records, and whether any caller has this
  shape yet.
- **Facing and a sight cone.** In a lit room every act is seen (`docs/limits.md`); the costliest of
  the limits, revisit when a concrete world needs what darkness, concealment and staging cannot give.
