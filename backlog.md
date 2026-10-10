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

1. [An experiment stage that advances on its own](#an-experiment-stage-that-advances-on-its-own).
2. [A manipulator](#a-manipulator).

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

### An experiment stage that advances on its own

The lab's `stage` moves only when the author edits it (`docs/limits-lab.md`, F). Beats already
run author edits at a tick, under a condition (`docs/beats.md`); two additions let one wait for a
condition over several entities and run once when it holds, which is a stage that advances itself
and, with a plain beat, a deadline.

- **`only_if: { all: [ ... ] }`:** a fourth form, true when every listed condition of the three
  existing forms holds (`{ entity, prop, op, value }`, `{ entity, in }`, `{ room, occupied }`);
  no nesting, from 1 to 16 entries, else `invalid_args` and, stored, `invalid_beat`. Each entry's
  `entity` or `room` must exist when scheduled (`no_such_entity`), as a single condition's must.
- **`repeat.until_ran: true`:** a repeating beat that ends after its first run whose action ran
  (the condition held and the edit was not refused). Until then a run whose condition is false
  records nothing, no `beat_skipped`, since a watch that finds nothing is not news; a failed
  edit still emits `beat_skipped` `failed` and the watch goes on. `times` still bounds it.
- **Where:** `src/engine/beats.ts` (the forms, the run), `src/engine/verbs/edit.ts` (the
  `schedule_beat` checks), the stored-beat rule in `src/engine/validate.ts`, `src/contract.ts`
  (the beat schemas).
- **Lab:** `tests/scenario-lab.test.ts` gains a step: the author schedules a watch, every tick,
  setting `stage` to 1 once the exit door is `locked` and `outside` is not `occupied`, and a
  deadline beat at a later tick setting it to -1 `only_if` `stage` is still 0. The terminal's
  remote lock with nobody outside advances the stage at the next tick; the deadline then finds
  stage 1 and is skipped `condition`.
- **Tests:** `tests/scheduled-beat.test.ts`: `all` true and false, with each form in it; a bad
  `all` refused (empty, 17 entries, nested, an unknown entity); an `until_ran` watch silent while
  false, running once, then gone from the schedule; one whose edit is refused emitting `failed`
  and running again; `cancel_beat` withdrawing a watch.
- **Docs:** `docs/beats.md` (both additions; split into a second file if it passes its cap),
  `docs/limits-lab.md` (the F line: the stage advances on a condition, and a watch reads at most
  once a tick, so a condition that holds and lapses within one command is missed).
- **Depends on:** nothing. **Not in it:** `any`/`not`, conditions on events (a door that was
  locked, rather than is), a stage the subjects or the AI can perceive (the experiment stays
  abstract), stages as data on the template.

### A manipulator

The lab has no arm the AI can drive (`docs/limits-lab.md`, A). The first try is the one the
roadmap named: an agent with hands and reach and no legs, run by the controller through the same
links as a door. One rule is new: an agent that is `controlled_by` something acts only while its
control walk carries the command, which is also the first agent whose power matters.

- **Template:** `templates/arm.json`: an agent with a `base` (no capacity) and a `gripper`
  (`manipulation` 50, `holds` grip, `max_integrity` 40 so one human blow destroys it), `reach_cm`
  150, `hand_height_cm` 100; no `moving`, `sight`, `hearing` or `speech`, so it addresses only what
  it can reach (`gropable`). Who sends its commands is the caller's: the AI's controller is handed
  `actorWorld(world, arm)` beside the terminal's.
- **Rule** (`src/engine/pipeline.ts`, after the agency check, before the target is resolved): an
  actor with `controlled_by` whose `remoteFault` is not null is refused with that fault's code and
  data (`disconnected`, `unpowered`), as `scenery` is refused there, a code no verb declares. An
  agent with no `controlled_by` acts as now, the terminal included.
- **Lab** (`scenarios/lab.json`): the arm in the lab within reach of the key, `powered_by` the
  cable, `controlled_by` the terminal. A second test in `tests/scenario-lab.test.ts`, from the same
  scenario: the arm takes the key before ann arrives; her `take` from its grip is refused (the
  existing grip rule); bob cuts the cable and the arm's `drop` is `unpowered`; ann attacks the
  gripper, the arm drops the key as a body that loses its hands does, and she takes it. The first
  test's steps are unchanged, the arm idle in them.
- **Tests:** `tests/manipulator.test.ts`: the arm takes, puts and gives within reach and is refused
  `out_of_reach` beyond it; it cannot `move` (`insufficient_moving` or the code the engine gives);
  every command is refused `unpowered` or `disconnected` at the link, with data, once a link
  fails, and works again when the author restores the link (`set_props`); an agent with no
  `controlled_by` is untouched by the rule; the arm's actor view holds only what touch and reach
  give it.
- **Docs:** new `docs/manipulator.md`; `docs/power.md` one line (a controlled agent);
  `docs/limits-lab.md` (the manipulator line becomes what the arm cannot do: see, move, or be
  driven by anything but a caller).
- **Depends on:** power and remote control (built); after the fault item, so its refusals carry
  `cut`. **Not in it:** an arm that sees through a camera, durations or a command in progress,
  joints or a track, the terminal's own power.
