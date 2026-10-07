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

Every item is ready now, and names anything it leans on; they can be taken in any order.

### The watch: a night scenario for beats and speech

`scenarios/camp.json` proved processes and eating end to end and wrote down what it could not say. Beats
and speech have only unit tests; a whole scene is what shows whether they compose, and what they still
cannot say.

- **Scenario `scenarios/watch.json`:** a lit gatehouse (`ann`, a guard, and `cal`, who is meant to be asleep), a door to a dark
  yard (`bob`, a traveller), a lantern, a table with a note. No seed needed.
- **Script** (`tests/scenario-watch.test.ts`, step letters as the other scenario tests use):
  - A: `schedule_beat` a loud knock on the door at tick 5, with a follower 3 ticks later that fails the
    lights (`set_props` `lit: false` on the gatehouse) `only_if` the lantern is not burning; `advance`
    with `stop_on_perceived: [ann]` ends at the knock (`advanced` is 5) and `ann` hears it, `bob` hears it
    too (loud, through the door), and so does `cal`, since sleep is not modelled.
  - B: `ann` shouts a token, `bob` hears it across the doorway; she whispers to `cal` and a bystander at
    300 cm does not; her `light` on the lantern makes the follower skip with `beat_skipped` / `condition`.
  - C: with the lantern left unlit the same chain darkens the gatehouse and `ann` can still hear `cal` say
    a token but cannot see the note or him.
  - D: the log replays to the same world, and `observe` for `bob` carries the shout's token and not the
    whisper's.
- **Limits file** `docs/limits-watch.md` (linked from `docs/limits.md`, `docs/DESIGN.md`), one line per
  limit with the step that shows it, as `limits-camp.md` does. Expected: a sound names its source entity
  and not "whoever is nearest"; a voice carries no identity (the token is all a hearer gets); a beat's
  action cannot depend on who is present; sleep is not modelled.
- **Depends on:** nothing (beats and speech have shipped).

### Repeating beats

A bell every ten ticks, a patrol that comes back: today that is a beat scheduled by hand each time.

- **Edit field:** `schedule_beat` (and a follower in `then`) takes `repeat: { every_ticks, times }`:
  `every_ticks` a positive integer, `times` an integer from 1 to 1000, the runs that come after the first. When
  the beat falls due, whatever happens (it ran, was skipped by its condition, or its action was refused),
  the next run is scheduled `every_ticks` later with `times - 1`, the same id, and the cause of the run
  before; at 0 nothing follows. Followers (`then`) are scheduled on each run that ran.
- **Counting:** a repeating beat is one pending beat and one id however many runs are left, so the 256
  bound and `duplicate_beat` are unchanged; `cancel_beat` withdraws the next run and so all of them.
  A repeat whose subject is gone ends with it, as every cause does.
- **Shape:** `parseScheduleBeat` / `parseChildren` in `src/engine/beats.ts`, the `beat` cause in
  `src/model.ts` and the schedule schema in `src/contract.ts` gain `repeat`; `beatInvalid` rejects a stored
  repeat out of range (`invalid_beat`); `beats.md` and `schedule.md` say so.
- **Tests** (`tests/scheduled-beat.test.ts`): a bell every 10 ticks three times rings at 10, 20, 30 and
  stops; a skipped run still schedules the next; cancel withdraws the rest; a long `advance` runs all of
  them; a repeat with followers; bounds (`every_ticks` 0, `times` 0 or 1001) are `invalid_args`; the
  property generator adds `repeat` to some beats and every step stays valid.
- **Depends on:** nothing.

### Rates that read a prop

`limits-camp.md`: hunger rises a point every ten ticks whatever the body does. A rate fixed in the
template cannot follow rest, work or cold.

- **Template field:** a process may declare `every_ticks_prop` (a prop name) beside `every_ticks`, which
  stays the default: when the process is scheduled, its delay is the entity's integer prop of that name
  if it is a positive integer, else `every_ticks`. The pending run keeps the delay it was scheduled with;
  the next run uses the prop's value then (`reconcile` / `runProcess` in `src/engine/process.ts`,
  `parseProcess` in `src/templates.ts`, which refuses a non-string or empty name).
- **Use it:** `human_hungry` hunger reads `hunger_every` (default prop 10), so `set_props` `hunger_every: 20`
  halves the rate for a resting body. This changes `human_hungry`'s hash; note it in the commit.
- **Docs and tests:** `docs/processes.md`, `docs/templates.md`, `docs/limits-camp.md` (the limit is
  removed); `tests/process.test.ts`: the delay follows the prop, a bad prop value falls back to
  `every_ticks`, a pending run is not retimed, the property fixtures include one such process.
- **Depends on:** nothing.

### Eating by portion, and recovering from starvation

Two more camp limits: bread is eaten whole, and a body that has eaten never recovers (`starvation` stays
where it reached).

- **Portions:** a solid may declare `portions` (a positive integer prop) and `nutrition` per portion: one
  `consume` eats one portion, lowers `hunger` by `nutrition`, emits `consumed` with `{ portions_left }`,
  and removes the thing with the last portion; without `portions` it is eaten whole as now
  (`src/engine/verbs/consume.ts`). Give `bread` `portions: 4`; its `nutrition` becomes per portion.
- **Recovery, template data only:** `human_hungry` gains a process `recover`, `while` `hunger` `lt` 100,
  `effect` `starvation` by -1 to `min` 0 every 5 ticks, so eating after a lapse winds the count down. This
  changes `human_hungry`'s hash; note it in the commit.
- **Docs and tests:** `docs/verbs-holding.md`, `docs/processes.md` if needed, `docs/limits-camp.md` (two
  limits removed); `tests/consume.test.ts`: four bites, `portions_left` counts down, the last removes the
  loaf, an unportioned thing is still eaten whole; `tests/scenario-camp.test.ts`: after eating, starvation
  falls to 0 over time instead of staying; the property fixtures cover a portioned food.
- **Depends on:** nothing.

### Property check: nobody learns words they did not hear

`tests/speech.test.ts` shows one whisper not reaching one observer. The rule is general, so the property
test should hold it over random runs.

- **Check** (in `tests/property.test.ts`, with the generator's `say` already in the verb table): after each
  step of a run, for every agent: each `say` in `since(0)` whose hearing is not true for that agent
  (`perceive` with the event, either end) appears in `observe(agent, { since: 0 })` without `utterance` and
  `volume`, and each one it did hear appears with both; and the agent's `command(..., { observe: true })`
  projection obeys the same. Counters assert that the run produced both kinds (heard and only-seen) so
  the check cannot pass empty.
- **Generator:** add a `say` weight where agents are in different rooms or at distances over the
  threshold, if the existing scenario does not already produce whispers out of earshot.
- **Depends on:** nothing.

