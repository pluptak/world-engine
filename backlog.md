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

1. [A refined entity starts the processes its new preset adds](#a-refined-entity-starts-the-processes-its-new-preset-adds).
2. [The scale benchmark builds its world again](#the-scale-benchmark-builds-its-world-again).
3. [The catalogue says when a default is approximate](#the-catalogue-says-when-a-default-is-approximate).

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

### A refined entity starts the processes its new preset adds

Probing `refine` (`docs/refine.md`) found that it does not start a process the new preset declares. A
`lantern` refined to a preset that extends it with a `leak` process on `fuel` (every 2 ticks, no `while`) leaves the
schedule empty and the fuel at 20 after six ticks; the same preset placed in a scenario leaks. `reconcileSince`
(`src/engine/process.ts`) reconciles only entities whose `props` or `entity` delta it sees, and `refine` writes its
props through `set`, which skips a no-op, so a preset that adds a process on props the entity already has
changes none: the `template` delta is the only trace and nothing reads it.

- **Fix:** `reconcileSince` also counts a `template` delta as touching its entity, so a refined entity is reconciled
  against its new preset like a spawned one: what can run is scheduled `every_ticks` from now, naming the `edited`
  event; a pending cause that can no longer run is withdrawn.
- **Older worlds:** one made before templates kept a `lineage` has none in its `templates.json`, so every `refine` on
  it is `not_a_refinement`. `upgradeTemplates()` with the shipped set rewrites its templates (the hash is the same)
  and refinement works; say so in `docs/refine.md`, and hold it with a test.
- **Tests:** `tests/refine.test.ts`: the `leak` lantern's fuel falls on the second tick and the cause names the
  `edited` event; a refinement whose new process cannot run (its `while` does not hold) schedules nothing; the
  world replays (`verifyWorld`) and a reopened one agrees; an older world (`lineage` deleted from its
  `templates.json`) is refused, upgraded, then refines and reopens as a candle.
- **Docs:** `docs/refine.md` (the older-worlds line), `docs/processes.md` (what reconciles a process: a spawn, a prop
  write and now a refinement).
- **Depends on:** nothing.

### The scale benchmark builds its world again

`npm run bench:scale` has not run since props were held to the schema: its `sprout` template sets `size` without
declaring it (`templates.json#sprout props.size is not a declared prop`), and once that is declared its chests are
written with `container`, `inner_*_cm` and `openable` in each scenario entry, which an entry may not do. No test
builds it, so nothing noticed. With a `size` field declared and the chest placed as an openable preset
(`extends: "chest"`, `openable: true`, `open: false`) it runs: 10000 commands, all ok, 12.2 ms per command (first and
last thousand alike), against the 10.6 in `docs/measurements.md`.

- **Share the world:** `scripts/bench-world.ts` exports `scaleRegistry()`, `scaleScenario()` and `scaleCommand()`
  (moved out of `scripts/bench.ts`, which imports them); the fixes above are made there.
- **Test:** `tests/bench-world.test.ts` builds the world (500 entities, 20 rooms), plays two laps of the cycle
  (`CYCLE` * `ROOMS` * 2 commands), asserts every one is ok and `validateSnapshot` is clean. It times nothing.
- **Docs:** `docs/measurements.md`: the scale row gets the new run, saying the earlier one predates the schema;
  `CLAUDE.md` needs no change.
- **Depends on:** nothing.

### The catalogue says when a default is approximate

`docs/catalog.md` says that spelling a preset's form defaults out places the same thing. It holds for every shipped
preset and fails for a preset whose figures are not whole percentages. A bottle extended with `liquid_amount: 100` of
750 is listed at `liquid: { material: "wine", pct: 13 }`, and that places 97. A preset with `hunger: 150` is listed
`hunger_pct: 150`, which `createWorld` refuses `invalid_form`. An architect that copies the defaults gets something
else, or an error, with nothing in the catalogue to warn it.

- **Fix:** `forms.approximate` (`src/engine/catalog.ts`, `CatalogResponseSchema`): the form names, `liquid` and
  `hunger_pct`, whose listed default is not what leaving it out places, in that order, absent when none. A `liquid`
  is approximate when the amount is not exactly `pct` of the capacity; a `hunger_pct` when the preset's `hunger`
  is over 100, in which case it is listed as 100. `fuel_pct` and `portions_pct` default to 100 and are always exact.
- **Test:** `tests/catalog-view.test.ts`: the two presets above list their form in `approximate`; every shipped
  entry lists none, and the existing round-trip test also asserts that an entry without `approximate` places as
  its defaults say.
- **Docs:** `docs/catalog.md`: the defaults describe leaving a form out; spelling one out is the same only when it
  is not in `approximate`.
- **Depends on:** nothing.
