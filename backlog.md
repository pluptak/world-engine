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
   blocks 3–8 in its order.
2. [Names that are Object members are not ids, templates or names](#names-that-are-object-members-are-not-ids-templates-or-names).
3. [Consumables: what a used-up thing leaves](#consumables-what-a-used-up-thing-leaves).

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
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

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

### Consumables: what a used-up thing leaves

A thing used up today simply goes: the last portion of bread is removed by `consume`, and a process
reaching its bound can `then` remove its entity (`{ remove: true }`, `docs/processes.md`). Nothing is
left behind, and a candle is not even used up: it inherits `lantern`'s `burn`, whose `then` only sets
`burning: false`, so a burnt-out candle stays (the plan's decision is that it goes:
`plans/presets-and-roles.md`). Breaking already has the shape this needs, `break_products` and
`break_residue`; being used up gets the same pair.

- **Template keys:** `spent_products` (`{ template, count }[]`) and `spent_residue` (material →
  amount), each defaulting to empty, declared, validated, inherited through `extends` and hashed as
  `break_products` and `break_residue` are (`src/templates.ts`).
- **One path:** `spendEntity(context, id, causeId)` in `src/resolvers/physical.ts`, beside
  `breakEntity`: emits `spent` on the entity, spawns each product where the entity was (its
  `support` or `contained_in`, `location` and `pos`; a thing held by an agent's grip or pocket
  instead lands at the holder's feet, as `drop` places it, since a grip holds one item), each a
  `spawned` caused by `spent`, adds `spent_residue` to where the products went (the support, the
  container, or the room under a dropped thing), then removes the entity (`removeEntity`) under
  `spent`.
- **Callers:** `consume`'s removal of a thing eaten whole or of its last portion
  (`src/engine/verbs/consume.ts`), and a new process `then` form `{ spent: true }`
  (`src/engine/process.ts`, `runThen`). `{ remove: true }` keeps its meaning, a removal with no
  products. The author's `edit remove` never spends.
- **`spent`:** a new event type with `SILENT_SENSES`, as `consumed` and `changed` have
  (`EVENT_SENSES` in `src/engine/query.ts`, its row in `docs/senses.md`); a product's `spawned` is
  sensed as a break product's is.
- **Templates:** `candle` declares its own `processes`, `lantern`'s `burn` with `then: { spent: true }`,
  and no products; `bread` declares nothing and is spent as before, leaving nothing. `templates_hash`
  changes. `tests/light.test.ts` "a candle is a lantern with less fuel" stops comparing the two
  processes.
- **Outcome:** a candle burning out on a table is gone, and the room is dark if it was the only light;
  a fixture with `spent_products` (an `ash`) and `spent_residue` leaves them on the table, or at the
  feet of the agent holding it; eaten bread leaves nothing; a pocketed fixture's products land at
  the pocket owner's feet.
- **Tests** (`tests/spent.test.ts`, its fixtures in an inline registry as `tests/process.test.ts`
  builds one): each outcome above, the event chain (`changed` → `spent` → `spawned`, `removed`),
  `trace` from a product back to the burn, and a store world that replays it byte for byte.
  `tests/property-gen.ts` gives its `lichen` or a new fixture `then: { spent: true }` with a product.
- **Docs:** `docs/processes.md` (the `then` form), `docs/verbs-holding.md` (`consume`),
  `docs/templates.md` (the two keys), `docs/senses.md` (the row).
- **Not in it:** a thing used up by a verb other than `consume` (no verb uses things up yet), and a
  burnt mark that is scenery (`plans/candidates.md`): until then a mark is `spent_residue`.
- **Depends on:** nothing; presets block 3 need not come first.
