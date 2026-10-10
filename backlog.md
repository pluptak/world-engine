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
4. [A scene carries its timeline, its slots and its limit](#a-scene-carries-its-timeline-its-slots-and-its-limit).
5. [A run starts, and ends](#a-run-starts-and-ends).
6. [A round: every player moves, in an order no one picks, and the clock moves once](#a-round-every-player-moves-in-an-order-no-one-picks-and-the-clock-moves-once).

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

### A scene carries its timeline, its slots and its limit

A scenario says what stands where (`{ seed, entities }`, read in `src/cli/main.ts`); everything
else a scene needs (`plans/roles.md`) is set after the world exists, by the author's edits. A
scene is the architect's whole setup, saved: the start of a run must not depend on edits.

- **Format** (`src/scenario.ts`, parsed there for the CLI and `createWorld` alike): the seeded form
  grows two optional keys. `beats`: a list of `schedule_beat` bodies (`id`, `at_tick`, `action`,
  `only_if`, `then`, `repeat`, as in `docs/beats.md`), `at_tick` from 1, naming entities by their
  scenario ids. `run`: `{ tick_limit?, slots? }`, `tick_limit` a positive int, `slots` a list of
  scenario ids, each an agent (`agent: true`), none twice. Unknown keys are refused, as now.
- **Validation** is the scene's, whole, before anything is built: a beat as `schedule_beat` would
  check it (shape, ids unique, subjects present, followers, the 256 bound), a slot that is no
  agent or no entity, a `run` with neither key. Each fails `invalid_scenario` with the path and the
  rule, as the scenario's other errors do; nothing is written.
- **Building:** the beats are queued at creation with a `cause_id` of `null` (a beat's cause today
  is the `schedule_beat` event; a null is a root, as a process the initial state started), so the
  stored beat shape and `validateSnapshot` allow `null` for a beat. `run` is kept on the snapshot
  (`run: { tick_limit?, slots? }`), absent when the scene has none, so every existing world stays
  as it is. The builder says whether either needs `schema_version` 6 (the store refuses an older
  world; a field only ever absent before may not need it) and names it in the commit.
- **Tests:** `tests/scene.test.ts`: a scene with beats builds a world whose schedule holds them at
  their ticks and runs them as an edited beat would; a follower chain and a repeat; each refusal
  once; `run` stored and read back by `snapshot()`; the CLI `init` and `createWorld` build the same
  world; a store world reopened keeps both. `scenarios/watch.json`'s knock, if it is an edit in its
  test, may move into the scene; the builder says.
- **Docs:** `docs/scenario.md` or the scenario section of `docs/api.md` (the two keys),
  `docs/beats.md` one line (a scene's beats have no cause).
- **Depends on:** nothing. **Not in it:** the pool of beats and the steerable odds (with the
  director's levers), the run's states (next item), a scene list.

### A run starts, and ends

A run is one simulation made from a scene (`plans/roles.md`). A world with `run` on its snapshot is
one: it waits to be started, runs, and ends for a reason, and after its end it is a record.

- **State** (`run.state` on the snapshot): `registering` when built, then `running`, then `ended`
  with `run.ended` `{ reason, tick }`, reason `director`, `tick_limit` or `no_live_players`. A world
  with no `run` is as now in every way.
- **Edits** (`src/engine/verbs/edit.ts`, the author's until roles exist): `start_run` on a
  registering run (else `run_not_registering`), `end_run` on a running one (else
  `run_not_running`), reason `director`. Each is recorded by its own root event, which nobody
  senses.
- **Gates** (`src/engine/pipeline.ts`): while registering, an agent's command and `advance` are
  refused `run_not_running` and take no time; the author's other edits are allowed (the scene may
  still be fixed). Once ended, every command and edit is refused `run_ended`; reads answer as
  ever.
- **The tick limit:** the clock never passes `tick_limit`: a command that would is cut at the
  limit (a `wait` or `advance` passes only the ticks left, as `advanced` says), what falls due at
  that tick runs, and the run ends there, `tick_limit`. A one-tick command at the limit is refused
  `run_ended` (the builder may instead end the run in the command that reaches it; it says which).
- **No live players:** with `slots`, after every ok command or edit, a run whose slots are all
  destroyed or gone ends, `no_live_players`. A run with no `slots` never ends this way.
- **The end:** the schedule is emptied, recording nothing; modifiers stay as they are, since no
  time passes again.
- **Tests:** `tests/run.test.ts`: a fresh run refuses a command and `advance`; `start_run` lets them
  through; `end_run` refuses everything after and reads still answer; a `wait` across the limit
  stops at it with what was due there run; a slot's body destroyed by an attack ends the run in
  that command; each refusal once; a world with no `run` passes all of it untouched. The property
  test's world has no `run`; a second generator with a small `run` is the builder's choice.
- **Docs:** new `docs/run.md` and its `docs/DESIGN.md` line; `docs/time.md` one line (the limit).
- **Depends on:** the scene item. **Not in it:** rounds (next item), roles and handles, who may
  start or end (the author for now), successors keeping a slot alive.

### A round: every player moves, in an order no one picks, and the clock moves once

Today each command moves the clock by its own duration, so one player's `wait` moves the world for
all, and the fast outpace the slow (`plans/rounds.md`). In a round every player decides against the
same world and the clock moves once.

- **API** (`src/api.ts`, `World.round(moves, options?)`; a CLI `round` op): `moves` is a list of
  commands, at most one per actor (else the round is `invalid`, `duplicate_actor`, and nothing is
  applied); an actor with none passes. `World.beat` (`docs/api.md`) is the nearest thing today: an
  ordered batch on one base, each command preempted by what an earlier one did.
- **Check:** each move is checked against the round's starting world, as a command is now; one that
  fails there is refused with its own code and takes no part.
- **Order:** the rest are applied in an order drawn from a stream of its own, a pure function of the
  seed and the tick (`src/engine/rng.ts` may host it), never `snapshot.rng`, so the jams a round's
  moves roll are the same whoever else moves. A world with no seed refuses a round of two or more
  moves `no_seed`. Each move is based on the round's starting version, so one that fails where it
  would have succeeded at the start is `preempted` (the store's rule), else refused with its own
  code. Nothing is retried.
- **Time:** a move takes no time of its own: every move of a round is at the round's tick, and the
  verbs that last longer than a tick (`wait`, `advance`) and `edit` are not moves (`invalid`,
  `not_a_round_move`). The command carries the round flag through the log, as `perceivers` does, so
  replay applies it the same way. After the moves the clock moves one tick (what falls due runs
  as now). An empty round is that tick alone.
- **The record:** each move is its own log line with its status, plus the round's number and its
  place in the order; the closing tick is a line of its own. `attempts` and `since` read them.
- **In a run:** while running, an agent acts only in a round (a lone `command` is refused
  `round_only`, `advance` too); outside a run, `round` works on any world, so it is testable alone.
- **Perception:** each move has its own before and after, so event-form perception and
  `perceivers` read as now.
- **Tests:** `tests/round.test.ts`: two agents take one key, one gets it and the other is
  `preempted`, and the same seed and tick give the same winner on every run while another tick may
  not; a door's jam roll is the same whether one or three agents move; a move refused at the start
  takes no part; `wait` in a round is `not_a_round_move`; an empty round is one tick; a self-closing
  door opened in a round closes on time; a store world replays a round exactly (`verify`); a running
  run refuses a lone command. The property test gains rounds of random moves.
- **Backlog:** `## Out of scope` drops "and two commands never share a tick".
- **Docs:** new `docs/rounds.md` and its `docs/DESIGN.md` line; `docs/time.md` (moves share a tick),
  `docs/api.md` (`round`).
- **Depends on:** the run item, for its gate alone. **Not in it:** handles and blind submission
  (who sees whose move is the next plan's), the director closing rounds or running empty ones,
  contest rules for a conflict, a carried agent's `move`.
