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

1. [Electric light: a powered lamp lights its room](#electric-light-a-powered-lamp-lights-its-room).
2. [The lab's power cut cuts power](#the-labs-power-cut-cuts-power).
3. [A beat that writes a definition prop is refused when scheduled](#a-beat-that-writes-a-definition-prop-is-refused-when-scheduled).
4. [A heard sound tells which way it came](#a-heard-sound-tells-which-way-it-came).
5. [A hand's carry limit](#a-hands-carry-limit).
6. [A player's observe is cheap on a stored world](#a-players-observe-is-cheap-on-a-stored-world).
7. [Submitting a move is cheap](#submitting-a-move-is-cheap).
8. [A command writes the snapshot every so often, not every time](#a-command-writes-the-snapshot-every-so-often-not-every-time).
9. [A long-lived process bounds what it keeps of each world](#a-long-lived-process-bounds-what-it-keeps-of-each-world).
10. [A run is played again from its world](#a-run-is-played-again-from-its-world).
11. [A reference host plays a run through the JSON ops](#a-reference-host-plays-a-run-through-the-json-ops).

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

### Electric light: a powered lamp lights its room

`isLit` (`src/engine/query.ts`) counts a room's own `lit` and a burning flame; nothing electric
lights a room, so a power cut cannot darken one (`plans/power.md`).

- **The rule** (`isLit`): a `light_source` with a `powered_by` lights its room while it is
  `powered()` and not destroyed or shut in a container, as a flame does while burning. `burning`
  stays a flame's prop; a room's own `lit` stays the architect's and is untouched by power.
- **Template:** a new `templates/lamp.json` (a `light_source`, no fuel, no `burning`), with
  `powered_by` written by the architect. The templates hash moves, as any new template does.
- **Tests:** `tests/light.test.ts`: a lamp on a running generator lights an unlit room, and sight of
  a stone there is true; the generator off (`on: false`, the first item) darkens it and sight is
  `false` / `location_unlit`; on again lights it; a lamp switched off itself darkens the room; a
  lamp with no `powered_by` lights nothing; a lit room's own `lit` ignores power.
- **Docs:** `docs/perception.md` (what lights a room), `docs/power.md` (lamps), `docs/templates.md`
  if it lists templates.
- **Depends on:** the first item. **Not in it:** a lamp's light reaching other rooms, dimness,
  a `darkened` event (open in `plans/power.md`).

### The lab's power cut cuts power

The lab run's pool beat `power_cut` sets the server room's `lit: false` by hand, and a limit says a
generator cannot fail (`docs/limits-lab.md`, "As a run").

- **Scene** (`scenarios/lab-run.json`): the server room loses its own `lit` and gains a lamp on the
  generator; `power_cut` becomes `update_props { on: false }` on the generator. `scenarios/lab.json`
  stays as it is.
- **Tests:** `tests/acceptance-lab-run.test.ts` row 6: after the cut the server room is dark
  (`isLit` false, a subject there sees `false` / `location_unlit`), and the AI, whose terminal runs
  on the generator, is refused `unpowered` with `cut` the generator for any move; the other rows
  pass unchanged, which they must, since the room is lit until the cut.
- **Docs:** `docs/limits-lab.md` (the generator line goes; what the run still cannot say stays),
  `docs/scenario.md` only if it describes the pool.
- **Depends on:** the three items above. **Not in it:** restoring power in the lab, a
  `darkened` event.

### A beat that writes a definition prop is refused when scheduled

A `set_props` or `update_props` beat that would change a definition prop is accepted when scheduled
and skipped when due (`beat_skipped`, code `field_not_editable`, from `propsRefusal` in
`src/engine/verbs/edit.ts`). Whether it changes one depends only on the subject's template and the
props written (`definitionWritten`), so it can never run.

- **Rule** (`beatPropRefusal` in `src/engine/validate.ts`, beside the prop checks the last item put
  there): after the per-prop codes, a `set_props` whose props would drop or change a definition, or
  an `update_props` that writes one with another value, is `field_not_editable`, read through
  `definitionWritten` itself, not a copy. `schedule_beat`, followers, a scene's beats and its pool
  all get it through the one function.
- **Tests:** `tests/scheduled-beat.test.ts`: `update_props { power_source: false }` on a generator
  is refused `field_not_editable` when scheduled; a `set_props` that leaves out a template's
  definition likewise; one that repeats the definition's own value is queued; a scene beat fails
  `invalid_scenario` with the rule.
- **Docs:** `docs/beats-actions.md` (the line the last item added gains the code).
- **Depends on:** nothing. **Not in it:** other edit kinds' refusals at scheduling.

### A heard sound tells which way it came

A listener in another room hears that something sounded, never from where (`docs/limits-lab.md`, "As
a run", row 3): an event sensed by hearing alone names no entity (`src/engine/projection.ts`), which
is right for the source, but a person can tell the direction.

- **Rule** (`projection.ts`): an event the observer senses by hearing alone, from another room,
  carries `heard_from`: the door between the observer's room and the event's room through which
  hearing reached it (open or shut, as `docs/senses.md`'s `+` and `B` columns decide). An event in
  the observer's own room, or one sensed by another sense, carries none. The door is named as
  anything in a projection is: an id in the world's projection, the actor's alias in its view
  (`src/actor-world.ts`), so a door the observer cannot name is still named by its alias, as a
  `reason_data` entity the actor has in view is.
- **Contract:** `heard_from` optional on the projection's event (`src/contract.ts`), and in the
  actor projection.
- **Tests:** `tests/projection.test.ts` (or the file that holds event projection): a knock in the
  next room heard through a shut door names that door; through an open one, that one; a knock in
  the observer's own room carries none; a seen event carries none; the actor view names the door by
  its alias. Row 3 of `tests/acceptance-lab-run.test.ts` asserts the alarm's door.
- **Docs:** `docs/perception.md` (one line), `docs/actor-view.md` if it lists event fields,
  `docs/limits-lab.md` (the row 3 line goes).
- **Depends on:** nothing. **Not in it:** the source's distance or loudness, a sound two doors away
  (hearing reaches one door today).

### A hand's carry limit

A hand carries any weight (`src/engine/carry.ts`: only a mouth's alternative reads a mass limit), so
one human carries another, or two (`docs/limits.md`).

- **Prop** (`src/engine/fields.ts`): `hand_carry_limit_g`, definition, integer; the most an agent
  holds in its hands at once, by the mass rule the mouth's `carry_limit_g` reads. Absent means no
  limit, so no animal changes.
- **Rule:** the `manipulation` alternative refuses `too_heavy` when what the hands already hold plus
  the item would pass the limit. `give` and `take` read it as they read the mouth's, through the
  alternatives (`carryCheck`); attack's drop-on-loss rule is unchanged.
- **Template:** `templates/human.json` gains `hand_carry_limit_g: 80000`: a human carries another
  (70 kg) but not two, nor anything heavier. **Decision to confirm:** 80 kg. The templates hash
  moves.
- **Tests:** `tests/carry-agent.test.ts`: a human carries a wounded human; a second body is
  `too_heavy`; one put down, the other is taken; the file that tests `too_heavy`: a 90 kg crate is
  `too_heavy` for a human. The property test's every step stays valid.
- **Docs:** `docs/verbs-holding.md` (the limit), `docs/limits.md` (the line goes).
- **Depends on:** nothing. **Not in it:** dragging, two agents carrying one thing, a body's weight
  slowing its walk.

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
