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

1. [The laboratory, with today's mechanics](#the-laboratory-with-todays-mechanics).

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

### The laboratory, with today's mechanics

The next world is an underground laboratory: eight test subjects trying to escape, and an AI
trying to finish its experiment while stopping them. Before anything is built for it, the lab is
written with what the engine has, and what it cannot say is recorded, each limit shown by a test.
That list decides the items after this one (the lab entries in `plans/candidates.md`).

- **Scenario:** `scenarios/lab.json`, lit rooms joined by doors (`from`/`to`): `dormitory`,
  `corridor`, `lab`, `server_room` and `outside`, the escape boundary (a subject has escaped when
  its `location` is `outside`). The exit door, corridor to outside, starts shut and locked; its key
  lies in the lab. Eight `human` subjects in the dormitory, each named. The AI's body is a
  `terminal` in the server room; the experiment is an `experiment` entity in the lab with a
  `stage` of 0. No camera, power or manipulator entity: there is no mechanic to give one.
- **Templates, the only two added:** `terminal`, an agent with one part contributing `sight`,
  `hearing` and `speech`, no `moving` and no `manipulation`; `experiment`, `abstract`, declaring
  `stage` (an integer) under `fields`. The AI's identity apart from its body is the caller's: the
  terminal is the body a scenario chose, and nothing in the engine is the AI.
- **Tests:** `tests/scenario-lab.test.ts`, lettered steps over one world:
  - A: the world builds, `validateSnapshot` passes, nine agents.
  - B: a subject walks dormitory, corridor, lab through open doors, takes the key, walks back,
    unlocks and opens the exit door and moves outside: escaped, by `fact` on its location.
  - C: the terminal perceives only the server room: an act in the lab is not sensed by it.
  - D: the terminal's `lock` of the exit door is refused, with the code the engine gives.
  - E: `stage` changes only by the author's `edit`; a subject's escape advances nothing.
  - F: closing the exit door with someone in its footprint pushes them aside (the existing rule).
  - G: `verify` passes, and the same scenario and commands replayed give the same log, byte for byte.
- **Docs:** `docs/limits-lab.md`, one line per limit with its step, in the form of the other
  limits files and naming nothing as a proposal: no remote control (D), no camera, so the AI sees
  only its own room (C), no power (an undeclared prop is refused), no manipulator, a stage nothing
  advances on its own (E), no AI apart from a body, and any other the steps show. One line in the
  `docs/DESIGN.md` limits list.
- **Depends on:** nothing. **Not in it:** any new rule, verb, relation or prop the engine reads; a
  limit is recorded, not fixed.
