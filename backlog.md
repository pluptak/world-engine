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
2. [The memoised snapshot cannot be mutated](#the-memoised-snapshot-cannot-be-mutated).
3. [An event-form perceive finds its event without a scan](#an-event-form-perceive-finds-its-event-without-a-scan).
4. [A beat that writes a definition prop is refused when written](#a-beat-that-writes-a-definition-prop-is-refused-when-written).
5. [The lab's power cut goes through the generator's on prop](#the-labs-power-cut-goes-through-the-generators-on-prop).
6. [The storage seam is an interface with no behaviour change](#the-storage-seam-is-an-interface-with-no-behaviour-change).

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

### The memoised snapshot cannot be mutated

- **What:** the per-process memo in `src/store/file-store.ts` (`currentMemo`) returns its snapshot
  without a copy, because a copy costs about what the parse saved. A caller that changes a snapshot it
  was given changes what the next read in that process sees.
- Deep-freeze the memo entry when it is stored, so a mutation throws in the caller's code. Measure
  it with `npm run bench:scale`, and keep it only if the rest phase moves by under 5%.
- **Decision to confirm:** freeze always (recommended, if the number holds) or only under tests.
- **Done when:** a test that mutates a snapshot from `openWorld` throws. The bench numbers are recorded
  in `docs/measurements.md`.
- **Tests:** `tests/file-store.test.ts`. **Docs:** `docs/persistence.md`, where "must not mutate"
  becomes a guarantee.
- **Depends on:** nothing.

### An event-form perceive finds its event without a scan

- **What:** `eventsThrough` (`src/store/file-store.ts`) finds the event with `findIndex` over every
  stored event, and `replayUntilEvent` calls it for each event a query names. In a world of 10k
  commands each such query scans the whole events list.
- Keep a map from `event_id` to its index in the cached events, extended by the lines appended since,
  as `cachedEvents` already extends them.
- **Done when:** `npm run bench:reads` shows the event-form perceive flat from 1k to 10k commands. The
  before and after numbers go in `docs/measurements.md`.
- **Tests:** the existing event-form perceive tests stay green, plus one that finds an event appended
  after the map was first built.
- **Depends on:** nothing.

### A beat that writes a definition prop is refused when written

- **What:** a beat that writes a definition prop is refused `field_not_editable` only when it is due,
  not when it is written (`plans/power.md`, "Template-defined props in a beat"). The check is in
  `src/engine/validate.ts` and `src/engine/verbs/edit.ts`.
- Make `schedule_beat` and `retime_beat` (`src/engine/verbs/edit.ts`) refuse such a beat with the same
  code, so the author learns when the beat is written.
- **Done when:** scheduling such a beat is refused at once, and the beat tests cover it. A beat already
  queued in a stored world keeps today's behaviour: refused when due.
- **Docs:** `docs/beats.md`, one sentence. No new refusal code.
- **Depends on:** nothing.

### The lab's power cut goes through the generator's on prop

- **What:** `plans/power.md`, item 4. The lab's server room should be lit by a lamp powered from the
  generator, and the run's power cut should be `update_props { on: false }` on the generator, not
  `lit: false` on the room. Today `scenarios/lab.json` gives `server_room` `lit: true` and no lamp, and
  `docs/limits-lab.md` records the hand-made cut as a limit.
- Add the lamp (a `light_source` with `powered_by` the generator's cable), make the cut a beat on the
  generator, and remove the limit line. The `on` prop and powered light in `isLit` are already built.
- **Done when:** the lab run's cut darkens the server room through `isLit`, not through a prop on the
  room. The lab acceptance test's expected log is updated, each changed line explained in the commit.
- **Files:** `scenarios/lab.json`, `docs/limits-lab.md`.
- **Tests:** `tests/acceptance-lab-run.test.ts`, `tests/light.test.ts`, `tests/power-switch.test.ts`.
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
