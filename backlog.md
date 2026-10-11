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

1. [The property tests generate switches](#the-property-tests-generate-switches).
2. [A player's observe is cheap on a stored world](#a-players-observe-is-cheap-on-a-stored-world).
3. [Submitting a move is cheap](#submitting-a-move-is-cheap).
4. [A command writes the snapshot every so often, not every time](#a-command-writes-the-snapshot-every-so-often-not-every-time).
5. [A long-lived process bounds what it keeps of each world](#a-long-lived-process-bounds-what-it-keeps-of-each-world).
6. [A run is played again from its world](#a-run-is-played-again-from-its-world).
7. [A reference host plays a run through the JSON ops](#a-reference-host-plays-a-run-through-the-json-ops).

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

_None: every item is shipped. Only the maintainer adds one, under Priorities._

### A player's observe is cheap on a stored world

One `observe` on the scale world costs about 130 ms (`docs/measurements.md`: the quiet rounds'
1,067 ms for eight). A host will have every player look every round.

- **Measure first:** `npm run bench:rounds` gains a row: one player's `observe` per round, split
  into the snapshot's load, the events' read, the entity half and the event half of the projection
  (`src/engine/projection.ts`). The split goes in `docs/measurements.md` and the commit.
- **Then the largest part:** make it cheaper without changing any answer: a projection is a pure
  function of the snapshot, the templates and the events, so work done once per call for each
  entity or sense (a room's light, the observer's room, a coverage lookup) is done once per call.
  Nothing is cached across calls or written to the world.
- **Tests:** a test compares every agent's projection of the scale world, and of the lab, before
  and after, by `canonicalJson`, from a fixed list of commands; the suite passes unchanged.
- **Record** the before and after in `docs/measurements.md`.
- **Depends on:** nothing. **Not in it:** caches that outlive a call, `inspect`, `options`.

### Submitting a move is cheap

Eight submits cost about 114 ms of a 220 ms round (`docs/measurements.md`). Each loads the snapshot,
builds the actor view to read the move's aliases back, reads `pending.json`, and rewrites it under
the world's lock (`storedPending` in `src/api.ts`).

- **Measure first:** split one submit in `bench:rounds` (the handle's binding, the view's decode,
  the pending write) and record it.
- **Then the largest part,** keeping the rules: a move is still decoded as the view's `check` reads
  it, the file is still written under the lock and atomically, and a second process still sees the
  move. Likely cuts: the alias table built once per submit, not once per value; one snapshot load
  per submit.
- **Tests:** `tests/player.test.ts` and `tests/player-slots.test.ts` pass unchanged; a test that a
  submit through one handle is seen by `pending()` through a handle of a second `openWorld`.
- **Record** the before and after in `docs/measurements.md`.
- **Depends on:** nothing. **Not in it:** batching submits, a pending store other than the file.

### A command writes the snapshot every so often, not every time

At 500 entities about 8 of the 10.6 ms per command is loading, serialising and writing the whole
snapshot, against 1.2 ms in the pipeline (`docs/measurements.md`); `deltas.jsonl` already holds
every accepted command's deltas (from `plans/candidates.md`).

- **Rule** (`src/store/file-store.ts`): `submit` writes `snapshot.json` only every 32 accepted
  commands, and the head records the version it holds (`snapshot_version`). `load`'s fast path
  reads that snapshot and folds the deltas after it (`deltas.jsonl`, from the byte the head names),
  and the snapshot is trusted as now otherwise. A process that holds the world keeps the snapshot it
  wrote in memory, so a run of commands does not reread it. **Decision to confirm:** every 32.
- **Kept:** `verify` replays from `initial.json` as now and also checks the stored snapshot against
  the replay at its version; a crash between writes loses nothing, since the log and deltas are
  written first; the head stays the last write. Checkpoints are unchanged.
- **Tests:** a new `tests/snapshot-interval.test.ts`: 100 commands, then a fresh `openWorld` reads
  the same snapshot as the writer, by `canonicalJson`; a crash simulated after the deltas and before
  the head recovers; a world written before the field opens and gains it; `verify` names a corrupted
  stored snapshot.
- **Record** `npm run bench` and `bench:scale` before and after in `docs/measurements.md`.
- **Docs:** `docs/persistence.md`. The candidate leaves `plans/candidates.md` in the same commit.
- **Depends on:** nothing. **Not in it:** compacting the log, a binary format.

### A long-lived process bounds what it keeps of each world

The parsed lines of `events.jsonl` and `deltas.jsonl` (`lineCaches` in `src/store/file-store.ts`)
and the head of `initial.json` (`initialMeta`) are module-level maps with no eviction, so a process
that opens many worlds, as a host does, keeps all their events until it ends (from
`plans/candidates.md`).

- **Rule:** each map keeps the worlds used most recently, at most 8 directories, and drops the
  rest; a dropped world is read again from its files on its next use, as a fresh process would.
  **Decision to confirm:** 8 worlds, counted by directory, not by records.
- **Tests:** a test opens 10 worlds in turn, then reads the first again and gets the same answers;
  the maps never hold more than 8 entries (read through a test-only count, not by exporting the
  maps).
- **Docs:** `docs/persistence.md` (one line). The candidate leaves `plans/candidates.md` in the same
  commit.
- **Depends on:** nothing. **Not in it:** a bound by memory, the checkpoints on disk.

### A run is played again from its world

A run that ended is a record; playing the scene again needs a new world. `init` builds one from the
scene file (`src/cli/main.ts`), but the file or `templates/` may have changed since, so the new run
would not be the same run.

- **API** (`src/api.ts`): `restartWorld(from, to)` makes a world at `to` from the world at `from`:
  its `initial.json` (the scene as it was built, the run registering, the beats queued, the seed)
  and its frozen `templates.json`. Nothing of the old world's log, pending moves or checkpoints is
  carried; the old world is not touched. Refused `world_exists` when `to` holds a world, and
  `no_such_world` when `from` holds none.
- **CLI:** `restart` op (`{ op, world, to }`), answering the new world's snapshot version.
- **Tests:** `tests/restart.test.ts`: a run of the lab played to its end, restarted, registered and
  played with the same moves gives the same log line for line; the old world still verifies; a
  template file changed after the first world was made does not reach the restart; both refusals.
- **Docs:** `docs/run.md` (playing again), `docs/api.md`.
- **Depends on:** nothing. **Not in it:** a list of scenes, editing a scene between runs (the
  architect edits the file), resuming a run mid-way.

### A reference host plays a run through the JSON ops

Everything a run needs is in the engine, but nothing drives one the way a real host would: through
the CLI's JSON requests, players that answer late, and a record of what each side saw.

- **Script** (`scripts/host.ts`, `npm run host -- <scene.json> <plan.json> <dir>`): creates the
  world (`init`), registers every slot the plan names (`director_edit`), starts it, and plays rounds
  until the run ends or the plan's last round: each round every player `player_observe`s, its
  scripted move is `player_submit`ted (or `idle`), then `director_close_round`. Every request goes
  through `runCli` in process (`tests/cli-run.ts` shows how), so the host sees only JSON.
- **The plan** (`plan.json`): per handle, the slot it takes and its moves by round, each a move as
  `player_submit` takes it, `"idle"`, or `"late"` (the player answers after the round's timeout).
- **Timeout:** a player is an async function; the host waits for each at most the plan's
  `timeout_ms`, and one that answers late passes the round, its answer dropped. **Decision to
  confirm:** a late answer is dropped, not kept for the next round.
- **Transcript** (`<dir>/transcript.jsonl`): one line per request and its response, in order, so a
  run can be read back as each side saw it.
- **Tests:** `tests/host.test.ts`: the lab run with a short plan (two subjects race for the key, the
  AI moves both bodies, one player is late) ends with the expected log; the late player's move is
  not in it; every transcript line's response validates against its op's schema; the world
  verifies.
- **Docs:** a new `docs/host.md` (what the host does and does not), its `docs/DESIGN.md` line.
- **Depends on:** nothing; best after the cost items. **Not in it:** an LLM player (a later item
  plugs one in as a player function), a network server, any prose.

### The property tests generate switches

`switch_on` and `switch_off` have generators in `tests/property-gen.ts` (`switchable`) but no band
in `SLOTS`, so no generated sequence ever switches. They were kept out because a band reshuffles
every sequence and exposed a crash in the actor view, since fixed (`bd94cfd`).

- **Generator:** the two verbs join a band of `SLOTS` (the openables' band, which they sit beside
  in `verbs/index.ts`), and the generated world (`buildInitial`) holds what they act on: a
  generator, a cable powered by it, and a lamp or a camera on the cable, so a switch has something
  to cut.
- **Then:** every property test file runs (`tests/property*.test.ts`, `options-property`,
  `projection-property`); a failure the new sequences find is an engine bug, fixed in this item with
  its own regression test that fails without the fix, never by choosing a seed that avoids it. A
  test that pins a count or an outcome of the old sequences is updated, and the commit says which.
- **Depends on:** nothing. **Not in it:** new properties.
