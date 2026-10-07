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

### Options name the arguments they can

`options` lists what a dry run accepts as it stands. The six verbs that need arguments (`give`, `put`, `move`,
`pour`, `say`, `wait`) come back only as names in `needs_args`, so the middleware must guess a recipient, a
container or a room the actor could in fact name, which is the kind of trial and error `options` was meant to end.

- **`Verb.suggest`:** an optional function on the verb (`src/engine/command.ts`, `Verb`) from the same context as
  `preconditions` to a finite list of arg sets, in a fixed order, cheap and without side effects: `give`, each
  agent the actor can name but itself, only when the target is held; `put`, `on` and `in` with each thing the actor
  can name but itself and the item, only when the target is held; `move`, `{ location }` for each room the actor can
  name (`nameableRoom` in `verbs/move.ts`, exported); `pour`, each vessel it can name with the whole `liquid_amount` of the
  target. `say`, `wait` and `advance` declare none: a token and a tick count are not a list.
- **In `options`:** a verb that answers `invalid_args` and has `suggest` is tried once per suggestion with the args
  set. `ready` and `blocked` entries gain `args` where a suggestion made them. `needs_args` keeps a verb that also
  takes arguments no list can hold, which the verb says with `free_args: true` (`move` to a position, `pour` a
  partial amount, `say`, `wait`), and drops one whose arguments are all listed (`give`, `put`): the declared
  `args` cannot say this, since `give` declares a `part` it never reads. `args` hold only ids the actor could
  already name, and nothing is added for a target it cannot.
- **Contract and docs:** `args?: Record<string, unknown>` on the ready and blocked entries in `OptionsResponseSchema`
  (`actorWorld` and the CLI's `actor_options` return the same type); `docs/api.md`, `docs/verbs.md` (what `suggest` and `free_args` are),
  `tests/catalog.test.ts` (a verb that needs arguments declares `suggest`, `free_args`, or both).
- **Tests** (`tests/options.test.ts`): ann holding a stone beside bob and a chest is offered `give` to bob, `put` on
  the table and in the open chest, `move` to the next room through a door and not to a room behind it; a thing she
  cannot name is never a destination; every suggestion that `check` accepts is `ready` and every other is `blocked`
  with its code; a store and a memory world answer alike. The property test in `tests/options-property.test.ts`
  also issues ready options that carry `args`, and every one is `ok`.
- **Depends on:** nothing. (It changes `OptionsResponseSchema`, which the CLI's `actor_options` answers with too.)

### A wait that ends when its actor senses something

`docs/limits-actor.md`: an idle character waits a tick at a time, because `wait` runs its whole count and only
the author's `advance` stops on what an agent senses; a controller has no other clock than its turns.

- **Verb:** `wait` takes an optional `args.until`, declared `{ kind: "enum", values: ["sensed"], optional: true }`.
  With it, `ticks` is an upper bound and `wake_on` names the actor itself, the rule `advance`'s
  `stop_on_perceived` applies (`advanceClock` in `src/engine/clock.ts`), and the `wait` event's data says
  `{ advanced: n }` as `advance`'s does. Without it, nothing changes.
- **Tests:** in `scenarios/watch.json` with the knock at tick 5, ann's `wait` of 20 `until: "sensed"` ends at tick 5
  with `advanced: 5`, the knock in its view; without `until` it runs to 20. `tests/scenario-night.test.ts`
  step A: the guard's idle turns become one such wait, and the limits line goes. The property test's duration
  check holds a wait that woke early.
- **Docs:** `docs/verbs-other.md` (the `wait` line), `docs/time.md`.
- **Depends on:** nothing.

### Open and close refuse what would change nothing

`docs/limits-actor.md`: `open` on an open door is `ok`, changes nothing and takes a tick, so options offer `open`
and `close` alike and a controller cannot read the door's state from them; `light` already refuses
`already_burning`.

- **Verbs:** `open` on an open target is refused `already_open`, `close` on a shut one `already_closed`, both
  declared in `refuses` (`src/engine/verbs/openable.ts`) and checked after reach. The schedule's own close
  (`runClose` in `src/engine/schedule.ts`) is not the verb and is unchanged.
- **Tests:** both refusals in `tests/openable.test.ts`; any test that opens what is open, or closes what is shut,
  changes to expect the refusal. `tests/scenario-night.test.ts` step C: the guard reads the open door from
  options (`close` ready, `open` blocked `already_open`) instead of remembering it, and the limits line goes.
- **Docs:** `docs/verbs-openables.md`.
- **Depends on:** nothing.

### From the far side of a door

`docs/limits-actor.md`: a door with a position stands in one room, so from the room it leads to nobody sees,
gropes for or reaches it, and nothing names the room behind it: bob in the dark yard cannot come in through
the door the guard opened. An unpositioned door is already reached from either room.

- **Reach:** in `gropable` (`src/engine/query.ts`) and openable's `inReach` (`src/engine/verbs/openable.ts`), a
  doorway whose `from` or `to` is the actor's room but which stands in the other one is reached as an
  unpositioned door is, from anywhere in the actor's room. In its own room it keeps its position.
- **Walking:** `move` takes `args.through`, an address resolved like a target (a name works), naming a door of
  the actor's room; the agent lands in the room on its other side, checked where it lands as a move by
  `location` is. A shut door is `no_open_door`; anything but a door of its room is `unresolved` or
  `invalid_location` as `location` answers. `args.location` stays.
- **Tests:** bob in the dark yard names, opens and closes the gatehouse door and walks in `through` it;
  `tests/scenario-night.test.ts` step E becomes bob coming in, and the limits line goes. A door of a third room
  is neither reached nor walked through.
- **Docs:** `docs/verbs-openables.md`, `docs/verbs-moving.md`, `docs/perception.md` (the door in `addressable`).
- **Depends on:** nothing.

### An inspection gives the footprint

`docs/limits-actor.md`: the view gives positions, not footprints, so the guard finds a free spot by the door by
trial, her first `move` refused `blocked`.

- **API:** `Inspection` (`src/engine/projection.ts`) gains `size_cm` (`w`, `d`, `h`, the template's), only with
  sight or touch, as `props` are; `InspectResponseSchema` in `src/contract.ts` takes it.
- **Tests:** `inspect` of the watch's door gives 90 × 10 × 200 to the guard in the lit gatehouse and nothing in
  the dark; `tests/scenario-night.test.ts` step C: the guard computes a free spot from dee's and the door's
  footprints and her first `move` is `ok`, and the limits line goes.
- **Docs:** `docs/projection.md` (the `inspect` paragraph).
- **Depends on:** nothing.

### The docs say what is built

`docs/` is meant to describe what is built, nothing aspirational, and several statements have been overtaken.

- **`docs/thesis.md`, `docs/overview.md`:** both say there is no randomness and that a caller who wants luck chooses
  a different command; the world has seeded dice in the snapshot (`docs/rng.md`) and a template process rolls
  them. Say that chance comes only from the snapshot's seed and replays exactly. The overview's "about 3.6 ms per
  command" becomes the measured figures and a link to `docs/measurements.md` (about 4 ms on a few entities, about
  10 ms at 500).
- **`README.md`:** the verb list lacks `say`, `light`, `douse`, `consume` and `advance`, and the bullets say nothing of
  speech, beats, processes, dice, the actor view or `options`. It stays at 15 lines.
- **`plans/roadmap.md`:** it is not linked from anywhere, lists "affordance enumeration" as not planned when `options`
  now is it, and is dated `875a1df`. Its "Not planned" list moves into the "Out of scope" section of this file, with
  the reason each was set aside; its "Done" list is dropped (git history has it); `plans/` is deleted.
- **Check:** `rg "no randomness|3.6 ms|affordance" README.md docs backlog.md` finds nothing stale afterwards, and
  `tests/catalog.test.ts` still passes (it ties the verb list to `docs/verbs.md`).
- **Depends on:** nothing. Run it last, so what it describes includes what the items above add.
