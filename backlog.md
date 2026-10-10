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

1. [A player's handle submits blind, and the director closes the round](#a-players-handle-submits-blind-and-the-director-closes-the-round).
2. [The director's levers: a pool of beats, a door's odds, and quiet rounds skipped](#the-directors-levers-a-pool-of-beats-a-doors-odds-and-quiet-rounds-skipped).
3. [A character being carried cannot walk](#a-character-being-carried-cannot-walk).
4. [A body that is destroyed may leave a successor, and the player follows it](#a-body-that-is-destroyed-may-leave-a-successor-and-the-player-follows-it).

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

### A player's handle submits blind, and the director closes the round

A round takes every move at once (`World.round`), so whoever calls it sees them all. Each player
submits on its own and sees only its own; the director closes the round without seeing what was
submitted (`plans/rounds.md`).

- **The player's handle** (`src/player-world.ts`): `playerWorld(world, handle)` is the actor view
  (`actorWorld`, `docs/actor-view.md`) of the registered slot's body, under the role `player`,
  without `command`, plus `submit(move)` (verb, target, args, as an `ActorCommand`; the actor is the
  slot), `withdraw()`, and `pending()` (its own move, or null). A new `submit` replaces the old. A
  handle not registered, or whose run is not running, is refused `not_registered` /
  `run_not_running`; `check` and `options` judge the move as a round's, as they now do.
- **Pending moves** are not world state: no version, no snapshot, no log line until the round
  closes. A store world keeps them in a file of their own beside the log (`pending.json`, written
  under the world's lock, `docs/locking.md`), a memory world in the handle's world; a `verify` and a
  replay ignore it. Nothing a player reads names another's move; the director learns only which
  handles have submitted (`submitted()`), never what.
- **Closing** (`directorWorld`): `closeRound()` takes every pending move, runs `World.round` with
  them under the role each player submitted with (so each move's log line says `player` and its
  handle, and the close says `director`), and clears them. The director's handle loses the bare
  `round` the last item gave it.
- **CLI:** `player_submit`, `player_withdraw`, `player_pending` and the actor reads under a
  `handle`; `director_submitted`, `director_close_round`.
- **Tests:** `tests/player.test.ts`: two players submit, neither's `pending` nor any read shows the
  other's; the director's `submitted` lists both handles and no move; `closeRound` applies both in
  the round's order with the right roles in the log; a resubmit replaces, a withdraw passes; an
  unregistered handle and a player before the start are refused; a store world's pending moves
  survive a second process opening it and are cleared at the close; `verify` passes with moves
  pending.
- **Docs:** `docs/roles.md` (the player), `docs/rounds.md` (submitting and closing).
- **Depends on:** the item above. **Not in it:** timeouts (the host's), the director's levers and
  empty rounds (next item), one handle driving several bodies.

### The director's levers: a pool of beats, a door's odds, and quiet rounds skipped

The director steers through what the architect tied (`plans/roles.md`): it moves queued beats
already; it cannot yet play a beat the architect left untimed, change a door's odds, or let time
run while every player waits.

- **The pool** (scene `run.pool`, `src/engine/scene.ts`): beat bodies with no `at_tick`, checked as
  the scene's beats are, ids unique across beats and pool, stored on the run. An edit
  `play_beat { id, at_tick }` (director and author) takes the beat out of the pool and queues it,
  caused by the edit's event; refused `no_such_pool_beat`, `beat_in_past`. A pool beat plays once.
- **Odds** (scene `run.odds`: `[{ entity, prop: "jam_pct", min, max }]`, doors only, as decided):
  an edit `steer { entity, prop, value }` (director and author) sets the value in force on the run
  (`run.steered`), refused `not_steerable` (no such entry) or `out_of_range`; `jams` in
  `src/engine/verbs/openable.ts` reads the steered value before the template's. The template's
  value is untouched, so nothing is written to a definition prop.
- **Quiet rounds:** a player's handle may `idle()`: it passes every round until it submits again.
  `closeRounds({ max, stop_before? })` on the director's handle closes empty rounds while every
  registered player with a live body is idle, refused `players_active` otherwise; it stops after
  `max`, one round before the beat `stop_before` names (as `advance` does), or after the first
  round whose events a registered player's body could sense (`sensedBy`, as `stop_on_perceived`),
  so no player sleeps through what reaches it. Each round is logged as a closed empty round.
- **Tests:** `tests/director-levers.test.ts`: a pool beat played sounds at its tick, a second play
  is `no_such_pool_beat`; a steered door jams at the steered odds (a seeded run, the roll pinned)
  and out of range is refused; quiet rounds stop at `max`, before a beat, and at a knock a player
  hears, and are refused while one player is active; every lever is in the log under `director`.
- **Docs:** `docs/roles.md` (the levers), `docs/scenario.md` (`pool`, `odds`), `docs/run.md`.
- **Depends on:** the two items above. **Not in it:** a budget of pulls, odds other than doors'
  `jam_pct`, a director that picks outcomes.

### A character being carried cannot walk

One character may carry another (`plans/roles.md`): nothing in `take` refuses an agent, and a hand
has no weight limit (`src/engine/carry.ts` limits only what a mouth carries). But a carried agent's
own `move` would pull it out of its carrier's grip.

- **Rule** (`src/engine/verbs/move.ts`): an agent held by another (in an agent's grip or mouth, or
  inside a container something holds) is refused `being_carried` on `move`, with
  `{ carrier }` in its data. It keeps its senses, speech and hands; `take` from its own grip and
  `drop` still work. Nothing else changes: its carrier moves it as any held thing.
- **Tests:** `tests/carry-agent.test.ts`: a human takes a dog, the dog's `move` is
  `being_carried` and it still sees the room its carrier walks into; dropped, it moves again; a
  human carries a wounded human (the builder notes that no weight limit applies, a recorded
  limit, not changed here) who can still `say`; a third agent's `take` from the carrier's grip is
  `held_by_another` as now. The property test's every step stays valid.
- **Docs:** `docs/verbs-moving.md` (one line), and
  `docs/limits.md` one line (a hand carries any weight).
- **Depends on:** nothing. **Not in it:** a weight limit for hands, struggling free, a carried
  agent's bite or attack on its carrier being refused (they work as now).

### A body that is destroyed may leave a successor, and the player follows it

A player whose bodies are all destroyed is out; a character meant to go on does so by its
template (`plans/roles.md`): its destruction leaves at most one agent, and the binding passes to it.

- **Template** (`src/templates.ts`, `src/engine/fields.ts`): `successor`, a definition prop naming
  one template, which must exist and be an agent; refused when the templates load otherwise, naming
  the template. No shipped template gets one, so the shipped set's `templates_hash` is unchanged;
  tests build their own registry.
- **On destruction** (`hurt` in `src/engine/harm.ts`, which the attack, the bleed and a process's
  damage share): after the `destroyed` and its drops, the successor is spawned where the body lies
  (its location, support and position), caused by `destroyed`, with `succeeds: <body id>` (a
  state prop, a history reference like `detached_from`, never a dangling link). What the body held
  falls as now; the body stays, destroyed.
- **The binding follows** by the record: a slot's live body is the slot's entity, or the newest
  successor along `succeeds` from it. `finishRun`'s `no_live_players` reads it, and a player's
  handle (after the player item) drives it and sees through it; until then `World.round` takes a
  move from the successor like any agent.
- **Tests:** `tests/successor.test.ts`: a template with a `successor` loads, one naming a non-agent
  or a missing template is refused; a body destroyed by an attack, by a bleed and by a process each
  leaves one successor where it lay, caused by `destroyed`; the successor of a successor; a run
  whose only slot dies with a successor keeps running and ends when the successor is destroyed;
  with the player item built, the player's handle drives the successor.
- **Docs:** `docs/templates.md` (the field), `docs/run.md` (a slot's live body), `docs/roles.md`
  if built.
- **Depends on:** nothing for the engine half; the player item for its handle test. **Not in it:**
  what the body held passing to the successor, a successor of a body removed rather than destroyed.
