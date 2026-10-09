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

1. [An observer reads an amount, not the exact figure](#an-observer-reads-an-amount-not-the-exact-figure).

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

### An observer reads an amount, not the exact figure

`inspect` returns a covered `liquid_amount` or `fuel` as stored, so a look tells 288 cm³ from 270.
Two more routes give the figure to an actor: `pour`'s `suggest` offers the vessel's whole `amount`,
so `options` lists it, and the refusals `too_much`, `overflow` (`pour`) and `insufficient_liquid`
(`consume`) carry `available` and `held`. The engine keeps the exact amount, which `pour` and
`consume` need; an observer gets a reading, a fixed band, never noise, so it replays.

- **Change:** `inspectEntity` (`src/engine/projection.ts`) leaves `liquid_amount` and `fuel` out
  of `props` and, where coverage names them, gives `levels: { liquid_amount?, fuel? }`, each
  `{ min_pct, max_pct }` of what full is: `liquidCapacity` for a vessel (export it from
  `verbs/pour.ts`), the template's own `fuel` for a light. None of a thing with no full (an
  unbounded destination, a template with no `fuel`). The band is whole percentages, in integers:
  0 is `0`–`0`, full or more `100`–`100`, otherwise with `k = floor(100 * amount / (full * step))`
  it is `k * step` to `min((k + 1) * step, 100)`; `step` is 25 by sight, or the thing's
  `gauge_pct`, a new definition prop (integer, 1 to 25, dividing 100; `src/engine/fields.ts`), a
  gauge marked on its side. `world.inspect` reads the same as the actor's: an inspection is a look,
  and the trusted caller has the figure in `entity`, `snapshot`, `fact` and `since`. `pour`'s
  `suggest` offers `{ destination }` alone (an absent amount pours everything already).
  `actorWorld`'s verdict drops `available` and `held` from `reason_data`; `requested` and
  `capacity` stay. `src/contract.ts`: `levels` on the inspection schema.
- **Tests:** a new `tests/readings.test.ts`: a bottle of 288 and one of 270 inspect alike
  (`25`–`50`); empty and full read `0`–`0` and `100`–`100`; a gauged preset (`gauge_pct` 10)
  tells 288 (`30`–`40`) from 200 (`20`–`30`); a lantern's 7 of 20 fuel reads `25`–`50`; a world
  whose coverage omits them shows no `levels`; a store and a memory world alike; `options` offers a
  pour with no `amount`; an actor's `too_much` names no `available`. The tests that read an exact
  inspected amount or a suggested `amount` move (`tests/options.test.ts`, those the change selects);
  `validateProps` refuses a `gauge_pct` of 0, 30 or 7.
- **Docs:** `docs/projection.md` (`levels`, without growing it), `docs/liquids.md` (the reading),
  `docs/fields.md` (`gauge_pct`), `docs/actor-view.md` (the dropped data), and the pour line in its
  `docs/verbs-*.md` family file.
- **Depends on:** nothing. **Not in it:** an actor can still bound an amount by the refusals of
  pours it tries, since a refused command costs nothing; the reading of anything else (`hunger`,
  `portions`).
