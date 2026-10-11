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

1. [The lab played as a run](#the-lab-played-as-a-run).
2. [Measure rounds](#measure-rounds).

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

Every item is ready now and names anything it leans on; the order is under Priorities.

### The lab played as a run

The lab (`scenarios/lab.json`, `tests/scenario-lab.test.ts`) drove every engine change, but it runs
command by command through the bare author. Played as a run it checks the whole stack at once:
scene, registration, blind rounds, the director's levers, successors and replay.

- **Scene** (`scenarios/lab-run.json`, beside the lab, which stays as it is): the lab's entities;
  slots for the eight subjects (one body each) and the AI (`[terminal, arm]`); the deadline as a
  queued beat; a pool of two (an alarm sounded in the corridor, the generator failing); the exit
  door's `jam_pct` steerable between 10 and 50; a tick limit of 60.
- **The script** (`tests/acceptance-lab-run.test.ts`): a scripted director registers every slot
  and starts; scripted players submit through their handles only, and the director closes rounds
  through its own. Each row is a test:
  1. Two subjects reach for the key in one round: one takes it, the other's move is `preempted`,
     and the same seed gives the same winner on replay.
  2. The AI locks the exit door through the panel while a subject at the panel unlocks it, in one
     round: the order decides, and both moves are in the log under their handles.
  3. Every player idles; the director skips quiet rounds, which stop the round the alarm (played
     from the pool) reaches a subject.
  4. The director steers the exit door's odds to 50 and the AI's next remote command may jam; out
     of range is refused.
  5. The terminal and the arm each move in one round under the one AI handle, and its view names
     the key alike from both.
  6. The run ends on its tick limit, refusing every later move, and `verify` replays it exactly.
  If a subject with a successor would serve a row, the builder adds a template for it in the test's
  own registry, never in `templates/`.
- **Findings:** whatever the run cannot say goes into `docs/limits-lab.md` under a short "As a run"
  heading, one line per limit with its row, as the lab's other limits are written. Engine bugs the
  script finds are fixed in the same item and named in the commit; a missing mechanic is a limit,
  not a fix.
- **Docs:** `docs/limits-lab.md`, `docs/scenario.md` (the lab run as the worked example).
- **Depends on:** nothing now; the two items it named are built. **Not in it:** an LLM player, a host loop beyond the test's
  script, timeouts.

### Measure rounds

Nothing has measured rounds: a submit writes `pending.json`, `closeRound` decides each move against
the round's start and then applies it, quiet rounds observe every player's body after each round,
and a camera's feed scans every entity on every perception.

- **Bench** (`scripts/bench.ts --rounds`, `npm run bench:rounds`): a store world of 500 entities in
  20 rooms (as `--scale`), 8 registered players and a director, 1,000 rounds of one move per player
  through the handles, then 200 quiet rounds; report ms per round for the first and last 100, and
  a split: submits, the round's check, its apply, the close, the quiet rounds' observation.
- **Record** the numbers in `docs/measurements.md` with the machine note the others carry. No
  optimisation in this item: if one part dominates, the commit says which, and a later item is the
  maintainer's to promote.
- **Tests:** the rounds workload builds and runs with tiny counts in the suite, untimed, as
  `tests/bench-world.test.ts` does for `--scale`.
- **Depends on:** nothing; best after the lab run, which may change what a round does.
  **Not in it:** any optimisation, caches (a candidate).
