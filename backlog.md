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

When nothing above is unblocked, stop and report. Gaps with no plan yet are in
[plans/candidates.md](plans/candidates.md); they are not work, and only the maintainer promotes one
to an item here.

## How the work runs

One item at a time on `main`. Sessions that run in parallel each work in their own git worktree and
commit only their own files. Additions to the shared registration points (`VerbRegistry.cs`,
`VerbSpecs.cs`, the `WorldError` codes, the contract in `src/WorldEngine.Contract`, the `docs/verbs.md`
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

- **What:** the TypeScript `tests/store-lock.test.ts`, "six processes writing one world take turns", failed once in a full-suite run:
  several ok commands were logged at the same version. `WorldLock.cs` is a port of the same takeover, so the hazard is in .NET too, and a
  full .NET run has failed once on a test not identified (it passed on two reruns): `WorldLockProcessTests` and `WorldLock.cs` are the
  first suspects.
- Reproduce under load: run `WorldLockProcessTests` in a loop with CPU stress in the background, logging each child's version decisions.
  Candidates: the takeover in `WorldLock.cs` (a lock of a dead process, or one over a minute old), the repair in `WorldSettle` that settles
  under the turn after looking again, and the process-local snapshot and head memory in `WorldReplay`/`WorldFiles` (keyed on file sizes
  and write times, so a second process's write within the clock's resolution is the case to rule out).
- **Findings so far (from TypeScript, not yet the cause):** under heavy load (16 busy processes on 12 cores) 22 of 50 runs failed:
  `store_busy` in some writers, `replay_diverges` in others. Two commands were accepted at the same version, so two writers held the turn
  at once, and one round left `lock.stale-<pid>` behind: a lock still in use was taken over. Hypothesis, not confirmed: the owner releases
  the lock and exits between the taker reading it and probing its pid; the next writer takes the new lock and the taker renames it away.
- **Next:** reproduce on .NET; then make a takeover proceed only when the stale verdict and the rename refer to the same lock.
- **Done when:** the cause is named in `docs/locking.md` and fixed with a deterministic test. If it does not reproduce in 50 loop runs,
  the test writes each child's log to a file on failure, so the next occurrence can be read.
- **Depends on:** nothing.

### The storage seam is an interface with no behaviour change

- **What:** `plans/storage-seam-design.md`, approach B, read for .NET. The .NET side already splits `IWorld`/`IWorldDriver`/`IWorldReads`
  (Core) from `StoreWorld` (Store); this item is the `WorldStore` interface over primitives (snapshot, log, events and deltas,
  checkpoints, templates, ids, and an exclusive turn) with the file code behind it and the memory world's record behind another, and one
  driver over both. The design doc names TypeScript files; map them with `CLAUDE.md`'s layout.
- Zero behaviour change: the same bytes on disk and the same CLI output. No SQLite code.
- **Done when:** `dotnet test dotnet/WorldEngine.slnx` passes with no test edit beyond names, and one new seam test shows the file and
  memory drivers fold a scripted log identically.
- **Depends on:** nothing.
