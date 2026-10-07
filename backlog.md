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

Every item is ready now, and names anything it leans on; they can be taken in any order.

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
- **Cause kind `beat`** (a row in `CAUSE_TABLE`): `{ kind: "beat", due_tick, entity, cause_id, id, action,
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
- **Depends on:** nothing (the cause-kind table and `advance` have shipped).

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
