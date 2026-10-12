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

1. [The intermittent multi-process failure has a cause](#the-intermittent-multi-process-failure-has-a-cause).
2. [The storage seam is an interface with no behaviour change](#the-storage-seam-is-an-interface-with-no-behaviour-change).
3. [An unconscious body senses and acts on nothing](#an-unconscious-body-senses-and-acts-on-nothing).

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
  ordered batch.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

### The intermittent multi-process failure has a cause

- **What:** `tests/store-lock.test.ts`, "six processes writing one world take turns", failed once in
  a full-suite run: several ok commands were logged at the same version. It passed in 14 later runs
  (solo, parallel, and on the earlier HEAD), so the cause is unknown.
- Reproduce under load: run the file in a loop with CPU stress in the background, logging each
  child's version decisions. Candidates to check: the takeover in `src/store/lock.ts` (a lock of a
  dead process, or one over a minute old), the repair in `load` that settles under the turn after
  looking again, and the read loop in `foldLogFrom`.
- **Findings so far (not the cause):** a light stress loop of the file passed every run. A heavy one (more busy
  processes than the machine has cores) failed `store_busy` in a writer that the 5 s turn timeout had run out on. The
  children now log each answer with its version, and the test keeps their logs when it fails. A candidate still
  to rule out: `release` in `src/store/lock.ts` gives up after its patience when unlink is refused (Windows, a reader
  holding the file), leaving the lock to a holder that no longer has it.
- **Done when:** the cause is named in `docs/locking.md` and fixed with a deterministic test. If it
  does not reproduce in 50 loop runs, the test writes each child's log to a file on failure, so the
  next occurrence can be read.
- **Depends on:** nothing.

### The storage seam is an interface with no behaviour change

- **What:** `plans/storage-seam-design.md`, approach B. A `WorldStore` interface over primitives
  (snapshot, log, events and deltas, checkpoints, templates, ids, and `runExclusive`). `FileWorldStore`
  is today's file code, and `MemoryWorldStore` is extracted from `memoryWorld`. One driver in
  `src/api.ts`, and the shared folds in `src/store/folds.ts`.
- Zero behaviour change: the same bytes on disk and the same CLI output. The exports of
  `src/store/file-store.ts` stay as wrappers, so tests keep their imports. No SQLite code.
- **Done when:** `npm run check` passes with no test edit beyond imports, and one new seam test shows
  the file and memory drivers fold a scripted log identically.
- **Depends on:** nothing, but best after the snapshot interval item, which changes the same file.


### An unconscious body senses and acts on nothing

- **What:** the decided condition (`plans/candidates.md`, Conditions): an author sets it, an edit ends
  it, and while it lasts the body takes every sense and every capacity. It follows the pattern `asleep`
  already uses (`docs/senses.md`).
- A state prop `unconscious` (boolean, absent means conscious) in `src/engine/fields.ts`. A scenario may
  write it (`ARCHITECT_PROPS` in `src/engine/forms.ts`), and an edit sets it (`update_props`).
- Its own commands are refused `unconscious` (`src/engine/pipeline.ts`, beside `asleep`).
- Its senses (sight, hearing, smell, touch) each answer `false` / `unconscious` (`src/engine/query.ts`,
  before the capacity check). `docs/senses.md` and `docs/senses-bases.md` record the basis.
- Its capacities read zero (`src/engine/capacity.ts`), as a stun lowers them but to zero. Structural
  capacities are unchanged, so what it holds is not dropped: a stunned victim keeps the rest
  (`docs/verbs-combat.md`).
- Others may still act on it: take, move, carry, hurt it.
- **Done when:** a scenario entry or an edit sets it; its own `say`, `move` and `take` are refused
  `unconscious`; its perceive answers `false` / `unconscious` for all four senses; `capacity` reads zero
  for every capacity; what it holds stays held; an edit setting it back to false restores everything.
- **Files:** `src/engine/fields.ts`, `src/engine/forms.ts`, `src/engine/pipeline.ts`,
  `src/engine/capacity.ts`, `src/engine/query.ts`, `docs/senses.md`, `docs/senses-bases.md`.
- **Tests:** a new `tests/unconscious.test.ts` that builds its own worlds inline, as `tests/sleep.test.ts`
  does. No new scene file, and existing scenario tests stay as they are.
- **Not in it:** what causes it (no hit, bleed or anaesthesia cause), ending it by time, a scene that
  uses it, and any change to `scenarios/lab.json`.
- **Depends on:** nothing; `asleep` is the pattern.
