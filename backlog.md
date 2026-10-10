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

1. [The schedule is read through the API](#the-schedule-is-read-through-the-api).
2. [A pending beat is brought forward or put back](#a-pending-beat-is-brought-forward-or-put-back).
3. [`advance` stops before a beat](#advance-stops-before-a-beat).

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

### The schedule is read through the API

Everything the world will do by itself is one list, `snapshot.schedule` (`docs/schedule.md`). A
caller that wants to read what comes next (the director and observer of `plans/roles.md`) digs
through `snapshot()`. Only a beat is ever named, by the id its author gave it; the engine's own
causes (a close, a bleed, a process) are read, never addressed, since no role may retime what the
engine decided.

- **Read** (`src/api.ts`): `World.schedule(filter?)`, `filter` `{ kind?, entity?, until_tick? }`,
  returns the pending causes in run order as stored. The CLI gets a `schedule` op
  (`src/cli/main.ts`, its request and response in `src/contract.ts` and `RESPONSES`). `actorWorld`
  gets nothing and the `actor_*` ops none: what the world will do is not something an actor knows.
  No stored shape changes, so `schema_version` stays 5.
- **Tests:** `tests/schedule-api.test.ts`: a door's `open` lists its close and `close` by hand takes
  it off; a bleed, a process and a repeating beat listed with their own fields; the filter by
  kind, entity and `until_tick`, and an empty list when nothing is pending; the CLI op answers the
  same; a store world reopened lists the same.
- **Lab:** step G (`tests/scenario-lab.test.ts`) reads the exit door's pending shut through
  `World.schedule({ entity: exit_door })` instead of the snapshot, if it reads it at all.
- **Docs:** new `docs/schedule-api.md` (the read, and that only beats are named; its
  `docs/DESIGN.md` line); `docs/api.md` the method.
- **Depends on:** nothing. **Not in it:** an id for the engine's causes, an actor's view of the
  schedule, roles.

### A pending beat is brought forward or put back

A story keeps its beats queued before the scene runs and moves them; it never invents one
(`plans/roles.md`). `cancel_beat` takes one off; nothing moves one.

- **Edit** (`src/engine/verbs/edit.ts`): `retime_beat { id, at_tick }`. The pending beat of that
  id falls due at `at_tick`, sooner or later, ordered after what is already due at that tick, as
  if scheduled now; `at_tick` must be ahead of the clock (`beat_in_past`). An id nothing pending
  carries is `no_such_beat`, as for `cancel_beat`; a follower not yet scheduled by its parent is
  not pending. A repeating beat moves its next run, and the runs after it keep `every_ticks` from
  there. Its action, condition, followers and cause are unchanged: a retime moves when, never what.
- **The record** is the edit's own root event, as for `cancel_beat`: no new event type, nobody
  senses it, `since` and `attempts` show it.
- **Tests:** `tests/scheduled-beat.test.ts` (or a new file if it is past its size): a sound beat
  brought forward sounds at the new tick and not at the old; put back, the same; a repeating
  beat retimed keeps its count and spacing; a chain's followers fall due from when the parent
  runs; two beats at one tick keep the order rule; both refusals; `check` of a retime writes
  nothing. The property generator retimes and cancels beats it reads from the schedule, and
  every step stays valid.
- **Lab:** a new step in `tests/scenario-lab.test.ts`: the deadline beat is queued, then brought
  forward before ann reaches the key, and the stage is what the earlier deadline makes it.
- **Docs:** `docs/beats.md` one line beside `cancel_beat` (split if past its size),
  `docs/schedule-api.md`.
- **Depends on:** nothing. **Not in it:** retiming the engine's causes (a door's shut, a bleed, a
  process), holding a beat with no tick, which role may retime (`plans/roles.md`).

### `advance` stops before a beat

A caller pacing the world to a story wants time to run up to a beat and stop there, so it can let
it run, move it or drop it. `advance` stops on what an agent senses (`stop_on_perceived`), never
on what is about to run.

- **Arg** (`advanceVerb` in `src/engine/verbs/wait.ts`, `src/engine/clock.ts`): `stop_before`, a
  beat id, optional. The advance ends at the tick before the beat falls due, everything due before
  it run, the beat still pending; `ticks` stays the upper bound, and `stop_on_perceived` may end
  it sooner. The `advance` event's `advanced` says how many ticks passed, as now.
- **Edge cases:** an id nothing pending carries is `no_such_beat`; a beat due at the very next tick
  leaves nothing to run up to and is refused `beat_not_ahead`, taking no time. A beat cancelled or
  pruned by what runs during the advance no longer stops it, and the advance runs its full
  `ticks`. A repeating beat stops it before its next run only.
- **Tests:** in `tests/schedule-api.test.ts`: an advance of 10 before a beat due in 4 ends after 3
  ticks with the beat pending, and an advance of 1 runs it; a beat pruned with its subject earlier
  in the span lets the advance run its full ticks; `stop_on_perceived` earlier than the beat wins;
  both refusals. Two advances that end where one would have leave the same world.
- **Lab:** the retime step starts with an advance stopped before the deadline beat.
- **Docs:** `docs/verbs-other.md` (`advance`), `docs/time.md` one line beside waking early,
  `docs/schedule-api.md`.
- **Depends on:** nothing (the retime item for its lab step). **Not in it:** stopping before an
  engine cause, a `wait` that stops before a beat (an actor does not know the schedule).
