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
   blocks 3c, 4, 4b, 5–8 in that order.
2. [Product templates exist when a set loads](#product-templates-exist-when-a-set-loads).
3. [A container holds only what fits](#a-container-holds-only-what-fits).

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

### Product templates exist when a set loads

`break_products` and `spent_products` name templates by id, and a set that names one no template declares loads
(`parseRegistry`, `loadTemplates`). The `TypeError` comes later, from the fall, the break or the last bite that
spawns it: a template that spends into `nonesuch` makes `advance` throw at the tick its burn runs, leaves the
world at tick 0 for good, and the CLI answers `internal_error`. `upgradeTemplates` already reports a live entity
whose template loses a product (`lostField`), but a set that never had one is not looked at.

- **Rule** (`resolveTemplates` in `src/templates.ts`, once every template is resolved): each product of
  `break_products` and `spent_products` names a template of the set, and not `room`, which nothing can be set
  on (`room_placed`), or the engine throws again at the spawn. A count of `break_products` is a whole number
  from 0, as `spent_products`' already is. Each refusal is a `TypeError` naming the template, the key and the
  product, as the others there do.
- **Kept:** `lostField`'s product checks stay: a registry handed to `memoryWorld` or `upgradeTemplates`
  is not always parsed.
- **Outcome:** the shipped set loads as it did; a hand-written set with an unknown, room or fractional product is
  refused when read, in a world's `templates.json` too, so no world is built that cannot advance.
- **Tests** (`tests/templates.test.ts`): each refusal for each key, through `parseRegistry` and
  `loadTemplates`, with the message; a product that exists, one declared by a child that extends, and a product
  that is a template defined later in the same set all load.
- **Docs:** `docs/templates.md`.
- **Depends on:** nothing.

### A container holds only what fits

`put` refuses `too_large` against a container's `inner_*_cm`, but nothing else asks: a scenario entry, `edit
place`, `edit spawn` and a spent product all put a table in a chest and the snapshot is valid (probed). A space part
(a pocket) already has the state rule, `part_contents_too_large`; a plain container has none. The author may write
"any state the world could reach" (`plans/presets-and-roles.md`), and a table in a chest is not one `put` can
reach.

- **Rule** (`validateSnapshot`, beside `part_contents_too_large`): an entity with `contained_in` a holder that
  has no holder parts, whose props give all three `inner_*_cm`, and whose size `misfit`s them is
  `container_contents_too_large` (path `entities.<id>.contained_in`). A container with no inner dimensions is left
  alone, as an agent holding by `in_part` is: only `put` reads them, and a container without them takes nothing
  by `put` already.
- **Refusal:** `container_contents_too_large` joins the `refuses` of `edit`, as `part_contents_too_large` is, and
  a scenario or `memoryWorld` is refused `invalid_snapshot` by it.
- **Spent products:** a product of `spendEntity` (`src/resolvers/physical.ts`) that does not fit the container the
  thing was in is set beside that container instead (its own place, as a held thing's is: the floor at its holder's
  feet, the support under it), so burning out in a small box can never make the clock's own result invalid. The
  residue stays in the container, since it has no size. (A break's products land on the support already.)
- **Not in it:** a process `remove` or a `consume` that lets go of what an inner thing held (`releaseDependents`
  moves its contents into the outer container) can still break the rule; `edit remove` is refused with the code, the
  clock's causes are not changed. Total volume (several things that each fit) is not checked, by `put` either.
- **Tests** (`tests/container-fit.test.ts`): the rule fires on a snapshot wrong in only that way and not on one that
  fits or on a container without dimensions; the scenario, `edit place` and `edit spawn` refusals leave the world
  unchanged; `put` is unchanged; a spent table-sized product in a small chest lands beside it and `advance` goes
  on, and one that fits stays inside; a chest carried or held. Existing tests that build such a state are fixed to
  fit. `tests/property-gen.ts` already places things into containers; the property run holds the rest.
- **Docs:** `docs/relations.md` (the `contained_in` row's code), `docs/state.md`, `docs/processes.md` (where a
  spent product lands).
- **Depends on:** nothing.
