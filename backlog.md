# Backlog

One item = one small block: plan it, build it, `npm run check`, review the diff, commit. Each item
keeps every invariant in AGENTS.md (determinism, pure core, `canonicalJson`, no prose,
coverage-governed `"unknown"`). Delete an item in the same commit that ships it — git history
records it; `docs/` describes what is built (index: `docs/DESIGN.md`).

**Scope line.** The engine is a library: a typed, in-process API through which a caller manipulates
objects, humans and animals and asks about the world. The CLI is one thin adapter over that API, and
there is no web server. Turning prose or intent into calls, and choosing calls that reach a desired
world state, is the job of a middleware that does not exist and is not part of this project. Items
below may make the API easier for such a caller to drive (describing its own commands, dry-running
one, structured refusals), but never interpret text or plan on a caller's behalf.

## How the work runs in parallel

P lands first, on `main`. Then lanes A–D run at the same time, one agent per lane, each in its own
git worktree and branch; a lane's items run in order. Each finished item is rebased on `main`,
passes `npm run check`, is reviewed, and merges one at a time. Lane Z starts once A–D have merged.

- **Owned files:** a lane edits only the files its items name, plus the shared registration points.
- **Shared registration points** — `src/engine/verbs/index.ts`, `src/errors.ts`, `src/contract.ts`,
  the verb table in `tests/property-gen.ts`, the verb list in `docs/verbs.md`, `CLAUDE.md` — take
  additions only, one line or one entry per change, so concurrent lanes conflict at most trivially.
- **No lane changes another lane's semantics.** If an item needs that, it stops and says so.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
- The limits in `docs/limits.md`, reassessed after the inn: none is worth a verb yet. Facing and a
  sight cone (an unseen act in a lit room) is the costliest and the first to revisit, when a
  concrete world needs what darkness, concealment and staging cannot give.

## Items

Each item names what it depends on. Ready now, in any order: Advance, Cause kinds as a registry, Fork
a world, Scale benchmark. Then, in a chain: Cause kinds → Template processes → Process effects →
Light sources and Consume (parallel) → Camp scenario. Seeded randomness follows Template processes;
Advance stops when an agent would notice follows Advance. Speech is ready now; Authored beats
follows Cause kinds as a registry and Advance.

### Advance: time with no actor

A controller that syncs several agents (human, AI) needs to move the clock without making someone
wait. Today only an agent's `wait` does that; `edit` is fixed at `duration: { ticks: 0 }` and the
`world` author is accepted only for `edit` (`src/engine/pipeline.ts`, `worldEdit`), so a `world`
`wait` is `no_such_actor`. The workaround, waiting as a living agent, is logged as that agent's act,
is perceived as it, and fails once the agent is destroyed.

- **Verb:** a new `advance` verb with `args: { ticks: { kind: "int" } }`, `duration: { arg: "ticks" }`,
  no target, no refusals beyond `invalid_args` for a missing or non-positive count. Like `edit`, only
  the reserved author `world` (`WORLD_AUTHOR`) may issue it; an agent issuing it is refused, and the
  code is declared in the verb's `refuses`.
- **Pipeline:** accept `WORLD_AUTHOR` as the actor for `advance` as well as `edit` (generalise
  `worldEdit`, don't special-case a second verb); `advanceClock` is unchanged, so expiries and
  scheduled causes run and emit under their own `cause_id`s exactly as for `wait`.
- **Events:** `advance` emits no root event of its own beyond what the pipeline emits for any ok
  command; what the span runs (closes, bleeds, expiries) is perceived like any other event.
- **API and CLI:** `world.command` carries it with no new method; check the CLI `command` op and
  `verbs` catalog list it; `check` dry-runs it.
- **Registration points:** one line each in `src/engine/verbs/index.ts`, `src/errors.ts` if a new
  code, `src/contract.ts`, the verb table in `tests/property-gen.ts`, and the `docs/verbs.md` index
  with its rule in the matching `docs/verbs-*.md` and `docs/time.md`.
- **Tests:** advancing runs a due self-close and a bleed and expires a modifier at the right ticks;
  `advance` by an agent is refused; `advance` with no agents in the world works; a stale
  `based_on_version` preempts as usual; replay from the log reproduces it; the property test mixes
  it in and every step stays valid.

### Cause kinds as a registry

`ScheduledCause` is a closed union (`src/model.ts`), `CAUSE_KINDS` and `runCause` in
`src/engine/schedule.ts` branch on `"close"` and `"bleed"`, and `validateSnapshot`
(`unknown_cause_kind`) and `src/contract.ts` repeat the list. A third kind means editing all four.
Make the kind a single table so the next item adds a row, not a branch. No behaviour change.

- One `CauseKind` table in `schedule.ts`: `{ kind, run(context, cause), valid(snapshot, cause) }`;
  `runCause`, `CAUSE_KINDS`, the `unknown_cause_kind` check and the `ResponseSchema` cause union all
  derive from it. `close` and `bleed` move into it unchanged, with their `remaining` rule.
- `ScheduledCause` stays a typed union; add a compile-time check that the table covers it.
- **Done when:** `npm run check` passes with no test edited except for import paths; the stored form
  and `SCHEMA_VERSION` are unchanged; `docs/schedule.md` names the table as the one place a kind lives.
- **Depends on:** nothing. **Blocks:** Template processes.

### Template processes: a prop that changes by itself

Nothing in the world changes over time except modifiers, doors and wounds. Let a template declare a
process that runs while a condition holds, so spoilage, fuel, hunger and decay are data.

- **Template field:** `processes: [{ id, every_ticks, while?: { prop, op, value }, effect:
  { adjust_prop: { prop, by, min?, max? } } }]`, all numbers integers, `op` one of `eq ne lt lte gt
  gte`. Validated in `src/templates.ts` (a bad shape is refused by template id and process id);
  inherited by `extends` like `props` (merged by `id`, child wins); part of the resolved template, so
  it enters `templates_hash` only for templates that declare it.
- **Cause kind `process`** (a registry row): `{ kind: "process", entity, process: <id>, due_tick,
  cause_id }`. Each run re-checks `while` against the entity's current `props`; if false it does
  nothing and is not rescheduled; if true it applies the effect, emits `changed` `{ prop, from, to }`
  under the cause's `cause_id` with a delta on `props`, and schedules the next run `every_ticks` later.
- **No polling.** The condition is reconciled when it can change, not on a timer: after any `props`
  write (`context.set` in `src/engine/pipeline.ts`) and after a spawn, the entity's processes are
  evaluated, scheduling one that is now true and has none pending, and withdrawing (`cancel`) one that
  is now false. A process with no `while` starts at spawn and runs until the entity is removed.
- **Clamping:** `adjust_prop` clamps to `min`/`max` when given; a run that changes nothing emits
  nothing and stops the process (it has reached its bound).
- **Perception:** one new `process` row in `EVENT_SENSES` / `docs/senses.md`: sight as `event`,
  hearing false (`quiet`), smell false, touch `O`. `changed` is the event type.
- **Storage:** a `process` cause is additive; bump `SCHEMA_VERSION` (now 5, in
  `src/store/file-store.ts`, which refuses any other value) only if an older stored world could not be
  read, and say which in the commit.
- **Docs and tests:** `docs/processes.md` (index line in `docs/DESIGN.md`), the new event in the
  property test's accounting, `tests/process.test.ts`: runs every N ticks across one long `advance`;
  stops at a bound; starts when a `set_props` edit makes `while` true and stops when it goes false;
  survives a template `extends`; a removed entity's process is pruned; replay from the log reproduces
  it; every random step stays valid.
- **Depends on:** Cause kinds as a registry. **Blocks:** Process effects, Light sources, Consume,
  Seeded randomness (its chance gate).

### Process effects beyond adjusting a prop

A decaying value is only useful if reaching it does something. Add the consequences, still as data.

- **`then`:** an optional `then` on a process, run once when an `adjust_prop` run reaches its `min` or
  `max`: `{ set_prop: { prop, value } }`, `{ damage: { amount } }` (takes `integrity`, emits `damaged`
  or `destroyed` the way a bleed does, so a body that starves out drops what it held, reusing the
  destroyed-body path in `runCause`), or `{ remove: true }` (the entity is removed under a `removed`
  event). Each emits under the process cause; `then` writes may start or stop other processes through
  the reconcile step.
- **Reuse, don't copy:** factor the "integrity reaches 0, destroyed, drop what it held" tail of the
  bleed run into one function used by both.
- **Validation:** a `then` that names a prop no template of that entity declares is allowed (props are
  free-form); `damage.amount` and every `by` are positive/non-zero integers.
- **Tests:** a fuel prop counting to 0 sets `lit` false; a hunger prop reaching its cap damages a
  human to destruction over a long `advance`, dropping what it held; `remove` on a spoiled item;
  the cause chain reads process, `changed`, `damaged`, `destroyed` under `trace`.
- **Depends on:** Template processes.

### Light sources

`lit` is a hand-set prop on a room (`src/engine/query.ts`, `same_location_lit`, `location_unlit`), so
darkness can never fall by itself. Make a room lit when it is declared lit or holds a burning light
source, and let a light burn out.

- **Derived light:** a room is lit if `props.lit === true` or any entity located in it, or carried by
  something located in it, has `props.light_source === true` and `props.burning === true`. One helper
  (`isLit(snapshot, room)`) used by both `sight` branches; adjacent-room sight keeps requiring both
  sides lit. Document the rule in `docs/perception.md` and `docs/senses.md`.
- **Verbs `light` and `douse`** (rules in `docs/verbs-other.md`, registered at the shared points):
  target must have `light_source: true`; `light` refuses `no_fuel` when `props.fuel` is declared and 0,
  and `already_burning`; `douse` refuses `not_burning`; both need the actor to reach the target
  (`inReach`) and `manipulation`, take one tick, and set `burning`, emitting `lit` / `doused`.
- **Templates:** `templates/lantern.json` (`light_source: true`, `burning: false`, `fuel: 20`) with a
  process `while burning eq true` adjusting `fuel` by -1 every tick to min 0, `then` set `burning`
  false. Add a `candle` extending it with less fuel.
- **Perception of the change:** `lit` and `doused` are sight-perceived in the room, so the standard
  row is fine; check `eventPerceivers` for an observer left in the dark after a `doused` (event-form
  perceive is true if perceptible before or after).
- **Tests:** a dark room becomes lit when the lantern is lit and an observer then sees a note; a
  carried lantern lights the room its carrier stands in and follows a `move`; it burns out during one
  long `advance` and the room goes dark, with the chain `lit`, `changed`, `changed` and so on; refusals.
- **Depends on:** Template processes, Process effects.

### Consume: eating and drinking

Hunger needs a counterweight. Add one verb that removes an item and applies its effect to the actor.

- **Verb `consume`:** target an item the actor holds or can reach (`inReach`), with `props.nutrition`
  (integer); effect: the actor's `props.hunger` goes down by `nutrition`, floored at 0, and the item
  is removed under a `consumed` event caused by the verb's root event. Refuses `not_consumable`,
  `not_in_reach`, and `mouth_full` for a creature whose jaw already holds something, all declared in
  `refuses`; one tick.
- **A liquid vessel** (`liquid_amount` > 0, `liquid_material`) consumed with `args.amount` takes that
  much from the vessel instead of removing it; refuse `invalid_args` beyond what it holds. Reuse the
  prop updates `pour` already does (`docs/liquids.md`).
- **Templates:** `templates/bread.json`, `nutrition` 40; a `human_hungry` template extending `human`
  with `hunger: 0` and a process `every 10 ticks, adjust hunger +1 to max 100, then damage 5`. Keep
  `human` itself unchanged so existing worlds keep their hash; decide in review whether to fold it in.
- **Tests:** eating bread lowers hunger and removes it; a full-hunger human takes damage over a long
  `advance`; consume refusals; a held bottle drunk down in two commands.
- **Depends on:** Process effects.

### Camp scenario: the three together

A scenario that exercises time-driven change end to end, as `inn` did for the verbs, so the next
limits list is written from a real world.

- **`scenarios/camp.json`:** a dark room with a lantern, a note under a book, bread, a hungry human
  (`human_hungry`) and a second observer, built with the existing spawn specs and `ScenarioOverrides`.
- **`tests/scenario-camp.test.ts`:** step letters like `scenario-inn.test.ts`: light the lantern and
  search; `advance` ten ticks and watch fuel fall; `advance` past burn-out and the room goes dark, the
  observer's `perceive` flipping `true` to `false` with `location_unlit`; the human starves to
  destruction, or eats and does not; `trace` of the starved human's integrity reads one chain back to
  the first `changed`; replay of `log.jsonl` from `initial.json` equals `snapshot.json`.
- **`docs/limits-camp.md`:** one line per thing the scenario wanted and could not say, in the form of
  `docs/limits.md`; link it from `docs/limits.md` and `docs/DESIGN.md`. Nothing there is a proposal.
- **Depends on:** Advance, Light sources, Consume.

### Seeded randomness

Chance (a hit that can miss, a spread that may not happen) must replay exactly, so the dice live in
the snapshot, not in `Math.random`.

- **State:** an optional `rng: number` on `Snapshot` (a 32-bit state), absent in a world that never
  rolls. `TransitionContext` gains `random(): number` (a small fixed generator such as mulberry32,
  written out in `src/engine/rng.ts`, no dependency), advancing `snapshot.rng`; the transition that
  rolled writes the new state, so `check` and a refused command never advance it.
- **Seeding:** `Scenario` gets an optional top-level `seed` (integer), carried by `createWorld`,
  `memoryWorld` options and `init`; `edit` can set it under the existing author rules. A world with no
  seed that reaches a roll refuses `no_seed` rather than inventing one.
- **First consumer:** an optional `chance_pct` (1-99) on a process, rolled each run: a failed roll
  skips the effect but still schedules the next run and emits nothing. Attack hit chance is not in
  this item.
- **Validation:** `validateSnapshot` accepts only an integer in range (`invalid_rng`); bump
  `SCHEMA_VERSION` only if needed.
- **Tests:** same seed and commands give a byte-identical snapshot and log through two handles and
  through replay; a different seed differs; a refused or `check`ed command leaves `rng` alone; a
  preempted command does not roll; the property test seeds its worlds.
- **Depends on:** Template processes.

### Fork a world

A caller running what-ifs or many rollouts should not hand-copy snapshots.

- **API:** `world.fork(): World` on both world kinds, returning a `memoryWorld` seeded from the
  current snapshot, with the same templates, names and coverage, whose own history starts at the
  fork's version (`since`, `attempts` and `trace` below it throw `history_unavailable`, as for any
  memory world). The fork shares nothing mutable with its parent: advancing one never touches the
  other, checked by deep-freezing the parent's snapshot in a test.
- **Store worlds** fork to memory, never to a directory; writing a fork out is the caller's job
  through `snapshot()`. A pending `rng` forks with it, so the fork continues the same dice.
- **CLI:** none; a fork lives in a process.
- **Docs:** `docs/api.md`, one paragraph; `docs/persistence.md` for what a fork is not.
- **Tests:** two forks given the same commands end byte-identical; given different commands they
  diverge and the parent is unchanged; a fork of a memory world after many commands answers `query`
  and `observe` as the parent did at that version; stale-command preemption still works inside a fork.
- **Depends on:** nothing (cleaner after Seeded randomness).

### Advance stops when an agent would notice

A controller that hands the turn to a human or an AI wants to run time forward and stop the moment
something happens that agent could sense, not after a fixed count.

- **Args:** `advance` gains optional `args.stop_on_perceived`: a list of agent ids. The `ticks` count
  stays the upper bound.
- **Behaviour:** the clock steps through due ticks as now; after each tick's events are emitted, if
  any new event is perceived by a listed agent (`eventPerceivers`, the existing batch form, so the
  same rule as `perceivers: true`) the clock stops at that tick and the command ends there. The
  result states the ticks actually elapsed (`advanced`), so a caller can resume with another
  `advance`. A listed agent that does not exist or is destroyed is `invalid` (`no_such_actor`, or
  `observer_destroyed` as `perceive` answers it).
- **Clock change:** `advanceClock` takes an optional stop predicate evaluated after each due tick; the
  duration `commandDuration` reports becomes an upper bound for this verb only. Check that
  `validateSnapshot`'s `schedule_not_ahead` still holds at an early stop (causes after the stop tick
  remain pending), and that `clock_overflow` is judged on the upper bound.
- **Tests:** a door set to close at tick 6 stops a 20-tick advance at 6 for an observer in the room
  and not for one in a sealed room; with no event the full count elapses; the stop never splits one
  tick's events; two advances end where one would have; replay of the log reproduces the early stop;
  the property test mixes it in.
- **Depends on:** Advance.

### Scale benchmark and the first fixes

`npm run bench` runs 10k commands on a four-entity world, so nothing says how the engine behaves with
a real world. Likely costs: `nextDue` in `src/engine/clock.ts` scans every entity's modifiers on each
command, `submit` in `src/store/file-store.ts` rewrites the whole snapshot, and `validateSnapshot`
runs on every accepted result.

- **Bench:** a second workload in `scripts/bench.ts` (behind a flag, default unchanged): a generated
  scenario of 20 rooms and 500 entities (a few agents among furniture, containers and items) and 10k
  mixed commands (move, take, drop, put, open, wait), seeded for determinism. Print ms/command for the
  first and last 1k, snapshot bytes, and a per-phase split (pipeline, validate, write) with
  `process.hrtime` around the three calls.
- **Report:** the numbers for both workloads in `docs/persistence.md` under "Scale", with the machine
  noted; a baseline, not a threshold.
- **Fixes allowed in this item:** only ones the split shows are the bulk, each with no behaviour change
  and `npm run check` green: an index of modifier expiry ticks instead of a scan, skipping validation
  work for entities a command did not touch if the deltas prove it safe, avoiding re-serialising
  unchanged parts. Anything larger is written up as a new backlog item with the measurement, not done
  here.
- **Depends on:** nothing; best run after Template processes, so processes are in the measure.

### Authored beats: the architect's scheduled interventions

An architect needs to say "at tick 305 someone knocks at the door, at 310 the lights fail" and have
the world do it, without scripting any character. A beat is the architect's intention, stored in the
snapshot; when it falls due it becomes ordinary events that every observer senses as it would any
others. (Not the same thing as the existing `beat` of `World`, an ordered batch of commands; call
this one a *scheduled beat* in code and docs, `ScheduledBeat`, cause kind `beat`.)

- **Authoring:** two new `WorldEdit` kinds, carried by `edit` like the rest (`src/engine/command.ts`,
  `src/engine/verbs/edit.ts`, `parseEdit`): `schedule_beat` `{ id, at_tick, action, only_if?, then? }`
  and `cancel_beat` `{ id }`. `id` is a caller-chosen token unique among pending beats
  (`duplicate_beat`; `no_such_beat` on cancel); `at_tick` must be ahead of the clock
  (`beat_in_past`), since the schedule only holds causes ahead of it. Mapping a tick to a wall-clock
  time such as 20:05 is the controller's job; the engine knows ticks only.
- **Actions (a closed set, data, never code):** `sound` `{ entity, loud? }` emits `sounded` on the
  entity (a knock, a bang, a bell); or any existing `WorldEdit` (`set_props`, `place`, `spawn`,
  `remove`, `set_part`) applied through the same edit transition at the due tick, so a power failure
  is `set_props` `lit: false` on a room and every consequence of the edit is sensed as usual.
- **`sounded` perception:** a new `EVENT_SENSES` row: hearing true in the entity's room, through a
  door only when `loud` (extend `loudEvent` in `src/engine/query.ts`); sight false with a new
  `basis_code` `unseen` (a sound is not seen); smell false; touch `never`. Add it to the table in
  `docs/senses.md`; `tests/senses.test.ts` fails until the row exists.
- **Conditional beats:** `only_if: { entity, prop, op, value }` (`op` one of `eq ne lt lte gt gte`)
  is read against the entity's `props` at the due tick. If false the beat does nothing and emits
  `beat_skipped` `{ id, reason: "condition" }`. If its edit is refused when it runs it emits
  `beat_skipped` `{ id, reason: "failed", code }` with the refusal code and changes nothing. Both
  events are authored work: use the `authored` sense row, nobody senses them.
- **Chained beats:** `then: [{ id, delay_ticks, action, only_if?, then? }]` are scheduled
  `delay_ticks` (positive) after the parent *runs*, each with the parent's event as its cause. A parent
  that is cancelled, skipped, or pruned schedules none of them. Bound the nesting depth at 4 and the
  total pending beats at 256 (`too_many_beats`) so a world cannot be made to schedule without end.
- **Cause kind `beat`** (a registry row): `{ kind: "beat", due_tick, entity, cause_id, id, action,
  only_if?, then? }`, `entity` the action's subject (a spawn's `location`), `cause_id` the event the
  `schedule_beat` edit emitted. A beat whose subject is removed is pruned with it, as every cause is
  (`pruneSchedule`), recording nothing; say so in `docs/schedule.md`. `cancel_beat` withdraws through
  `cancel`.
- **Validation:** `validateSnapshot` checks a beat's shape, a unique `id`, and the nesting and count
  limits (`invalid_beat`, `duplicate_beat`, `too_many_beats`). Declare every new refusal code in the
  edit verb's `refuses`, `src/errors.ts` and `src/contract.ts`; the CLI `edit` op carries both new
  kinds.
- **Docs and tests:** `docs/beats.md` (index line in `docs/DESIGN.md`), a paragraph in
  `docs/schedule.md`. `tests/beat.test.ts`: a knock at tick 5 is heard by an observer in the room and
  by one next door only when loud, never seen; a `set_props` beat darkens a room and an observer's
  `perceive` of a note flips to `location_unlit`; `only_if` false skips and emits `beat_skipped`; a
  refused edit at fire time skips with its code; `then` runs after its parent's delay and not after a
  cancel; two beats due at one tick run in the order scheduled; a long `advance` runs a whole chain;
  replay from the log reproduces it; `perceivers: true` names who sensed a knock; the property test
  schedules, cancels and fires beats and every step stays valid.
- **Depends on:** Cause kinds as a registry, Advance (to let time pass with no actor in the tests).

### Speech: saying something without the engine reading it

Characters talk, and who hears it is a perception question the engine can answer. What it means is
not, and the engine must never hold the words (`AGENTS.md`: no prose crosses the boundary; the engine
owns world state, never knowledge). So a speech act carries an opaque token the caller made up, and
the caller keeps the text.

- **Verb `say`:** optional target (the addressee, any entity address); `args.utterance`: a token
  matching `^[A-Za-z0-9_.:-]{1,64}$` that the engine stores and never interprets (the controller maps
  it to text outside); `args.volume`: `whisper`, `normal` (default) or `shout`. Needs a `speech`
  capacity from the actor's parts (`requires`, like `manipulation`), takes one tick. Refuses
  `invalid_args` (missing or malformed token, unknown volume), `insufficient_speech`, declared in
  `refuses`. Emits a root event `say` on the speaker with `{ utterance, volume, to? }`; `to` is the
  addressee as a plain fact of the act, not a claim that anyone understood. Add an `ArgDecl` kind for
  the token (`src/engine/command.ts`, `src/contract.ts`) and an optional-arg rule if none exists.
- **Hearing:** a new `EVENT_SENSES` row for `say`, sight as the `event` row (speaking is seen in a lit
  room, its words are not heard by sight), hearing by volume: `whisper` is heard only within
  `NEAR_THRESHOLD_CM` of the speaker in the same room (a new `same: "near"` rule beside `always`; both
  positions must be known, else false); `normal` is heard everywhere in the speaker's room and not
  through a door; `shout` is heard in the room and crosses a doorway (extend `loudEvent`: `say` with
  `volume: "shout"`). Smell false, touch `body`. A speaker hears their own `say`.
- **Projection must not leak the words.** `ObservedEvent` (`src/engine/projection.ts`,
  `ObservedEventSchema`) gains optional `utterance` and `volume`, present only when the observer's
  hearing of that event is true; an observer who only *saw* the speaker has the event and the sense
  `sight` and no token. Raw `Result.events` and `since` stay the omniscient record and carry the
  token, as they carry every event's data. A test must show a seeing-but-not-hearing observer's
  `observe` and `command(..., { observe: true })` contain no `utterance` anywhere.
- **Capacity:** add `speech` to the `head` of `templates/human.json` (`contributes`); this changes
  the template hash, so existing stored worlds report `templates_changed` and need
  `upgradeTemplates` (`src/engine/upgrade.ts`) or a re-init; note it in the commit and
  `docs/templates.md`. Animals get none. A destroyed body is no agent (`not_an_agent`); a severed head
  contributes nothing, so a headless body is `insufficient_speech` with no extra rule.
- **Docs and tests:** `docs/speech.md` (index line in `docs/DESIGN.md`, verb line in `docs/verbs.md`,
  rules in `docs/verbs-other.md`). `tests/speech.test.ts`: normal speech heard in the room and not
  next door, shout heard next door through an open door and a shut one, whisper heard at 40 cm and not
  at 300 cm; the dark room still lets an observer hear but not see the speaker; `to` recorded;
  refusals; `perceivers: true` names exactly who heard; replay from the log reproduces it; the
  property test generates `say` and every step stays valid.
- **Depends on:** nothing. Pairs well with Advance stops when an agent would notice: a stopped
  advance can hand the turn to whoever heard.
