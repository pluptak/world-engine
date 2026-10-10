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

1. [A run starts, and ends](#a-run-starts-and-ends).
2. [A round: every player moves, in an order no one picks, and the clock moves once](#a-round-every-player-moves-in-an-order-no-one-picks-and-the-clock-moves-once).

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
