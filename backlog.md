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

### Writers take turns

`src/store/file-store.ts` has no lock, and the CLI is one process per request, so a caller that issues two at once
has two writers on one world. `submit` is load, decide, append the log, events and deltas, write the snapshot, write
the head; a second process that loads between those steps decides against a version already left, and `load`'s
repair rewrites files under a writer it raced. Measured (a scratch run, four processes of 50 `take`/`drop` each on
one world): three exit with `EPERM` on the rename of `snapshot.json.tmp`, a name every writer shares, and the log
holds 57 `ok` lines at 54 distinct versions. Commands that conflict could make the next open replay one that
no longer applies, which throws; that case was not reproduced.

- **Lock:** a `lock/` directory in the world, made with `mkdirSync` (atomic across processes), with `owner.json`
  (`{ pid, since_ms }`: the one use of the wall clock, never read into world state). Taken by `submit` around its
  whole body, by `writeWorldTemplates` and the template settle in `load`, and by `load`'s repair: the fast path
  stays lock-free, the slow path takes the lock and looks again before it rewrites anything. Re-entrant within a
  process (`submit` calls `load`). Temporary files take the pid in their name.
- **Waiting:** polls every few ms (`Atomics.wait` as a synchronous sleep) up to a timeout (5 s by default,
  `WORLD_LOCK_TIMEOUT_MS` to change it), then `WorldError("store_busy")`, which surfaces as a CLI issue code. A lock
  whose pid is gone, or older than a minute, is removed and retaken; a crash inside a submit is settled by the
  recovery `load` already has (the log is the truth).
- **Tests** (`tests/store-lock.test.ts`, children spawned with `node --import tsx`): six processes of twenty
  commands each against one world end with 120 log lines, 120 distinct versions, a snapshot that equals the replay,
  and no `.tmp` files; a lock held by a live process makes another fail `store_busy` after a short timeout; a lock
  left by a dead pid is taken over; a reader that opens mid-write waits instead of repairing. `npm run bench`
  before and after goes in `docs/measurements.md` (one `mkdir` and `rmdir` per command).
- **Docs:** `docs/persistence.md` ("Writers take turns"), `CLAUDE.md`. Memory worlds hold their own state and are
  untouched.
- **Depends on:** nothing.

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

### The night shift, seen from inside

Each scenario so far (`inn`, `workshop`, `camp`, `watch`) was written from outside, with the whole `World` in hand, and
each produced a limits file. None has been played the way a middleware would: through `actorWorld` alone, deciding
from `observe` and `options`. That is the test of whether the controller-facing API says enough.

- **The script** (`tests/scenario-night.test.ts`, on `scenarios/watch.json`): the test holds the `World` only to
  schedule the architect's beats and to assert at the end; ann (the guard), cal and bob (in the dark yard) each
  hold only an `actorWorld`. A policy for each is a pure function of that actor's last `observe` and `options` (for
  example: a guard who hears a `sounded` event from `here` or `next_door` lights the lantern before the lights
  fail, walks to the door and opens it; bob, hearing a shout, answers with a whisper), written without reading any
  entity the view did not list. Where a policy cannot choose from what it was given, the step says so.
- **What it asserts:** the night plays out (the knock, the lantern, the door, the words heard by exactly who could
  hear them); every id in everything an actor was ever sent (views, options, verdicts) is the actor, its room, or
  something its own views or options listed or it named itself; two runs from the same seed give the same record.
- **Findings:** `docs/limits-actor.md`, one line per thing the controller could not decide from inside and the step
  that shows it, as the other limits files do (nothing in it is a proposal); anything that is a plain defect is
  fixed in the same change with its test, and anything that is a gap goes to this backlog as its own item.
- **Depends on:** nothing. (It runs better once options carry arguments, but does not need them: it records the
  gap if it lands first.)

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
