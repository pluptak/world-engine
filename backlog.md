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

### The history of a field without replaying the log

`docs/measurements.md` (cost of a read): after checkpoints, `trace` of a field's history is the one read that
still replays the whole log (379 ms at ten thousand commands), because the deltas it follows are not stored
anywhere but in the replay.

- **Store the deltas:** `deltas.jsonl`, one canonical line per delta, appended by `submit` beside the events and
  written before the snapshot, with its byte size in `head.json` (`deltas_bytes`). A stored world made before
  it has none: `load` rebuilds it from the log as it rebuilds events, and `schema_version` goes to 6 with an
  upgrade path that does exactly that, so older worlds open.
- **Read it like the events:** a handle parses it once and extends it by the lines appended since
  (`cachedEvents` in `src/store/file-store.ts` is the pattern, with its anchor check), and `trace` of an entity's
  field is answered from the cached events and deltas with no replay. `since`'s deltas can then come from the
  file as well when the checkpoints are not needed.
- **Crash rules:** the recovery in `load` compares deltas as it does events, and a mismatch rebuilds both from
  the log. Replay stays the source of truth.
- **Tests and numbers:** answers equal the replay's byte for byte (property-driven store world, with the file
  deleted and truncated); a world at schema 5 opens and gains the file; `bench:reads` shows the field trace flat.
  The numbers replace the field-history row in `docs/measurements.md`.
- **Depends on:** nothing.

### A projection names only what the observer senses

`limits-watch.md`: whoever hears a `say` is told who spoke, even in the dark. The same holds for every event
only heard: `ObservedEvent.entity` names the source of a footstep in a dark room, the door of a knock the
observer cannot see. `docs/projection.md` says a projection must not list what the observer cannot tell is
there; its events do.

- **Rule:** an event keeps its `entity` when the observer senses it by sight, smell or touch (event-form
  `perceive`, as now). An event sensed by hearing alone has no `entity`; it carries `from` instead,
  `"here"` (the observer's own room, basis `same_location`) or `"next_door"` (`adjacent_loud_event`). Make
  `entity` optional in `ObservedEvent` (`src/engine/projection.ts`), `ProjectionSchema`
  (`src/contract.ts`) and `observeThrough` (`src/api.ts`), which already reads the hearing answer and its
  basis; `command(c, { observe: true })` shares the path.
- **What does not change:** `Result.events`, `since`, `trace` and `perceivers` stay the omniscient record and
  name every entity; `perceive` itself is untouched.
- **Docs and tests:** `docs/projection.md`, `docs/speech.md`, `docs/senses.md`; `docs/limits-watch.md` loses
  the speaker line and gains "a voice heard in the dark names nobody: the controller knows who spoke only
  because it issued the command". `tests/speech.test.ts` and `tests/scenario-watch.test.ts` change to the
  new rule (step C asserts no `entity`, `from: "here"`); a footstep heard in a dark room names no walker;
  a lit room still names both. The property check in `tests/property.test.ts` gains: no view event whose
  senses are exactly `["hearing"]` has an `entity`, every other has.
- **Depends on:** nothing.

### Options: what an agent can do now

A middleware choosing an agent's next action has to try verbs to learn which are possible. `check` dry-runs one
command; nothing lists the commands that would work. (The scope line allows describing and dry-running
commands; choosing among them stays the middleware's.)

- **API:** `world.options(actor, { refused? })` returns `{ actor, version, ready, needs_args, blocked? }`.
  Candidates are every verb in the catalog that is not `author_only`, against each entity the actor can
  address (`addressable` in `src/engine/query.ts`, the rule target resolution applies, with `byId: false`
  so a hidden thing is never offered: listing it would reveal it), excluding the actor, and once with no
  target for a verb that does not `requires_target`. Not the projection's `entities`: those miss what the
  actor can only grope for in the dark, which a command can name, so options would offer less than
  `command` accepts. Each candidate is dry-run with no args through `check`'s
  path (never logged): `ok` goes in `ready` as `{ verb, target? }`; `invalid` / `invalid_args` means the verb
  needs arguments and its name goes in `needs_args` (sorted, once); anything else is a refusal, listed in
  `blocked` as `{ verb, target?, reason_code }` only when `refused: true`. Sorted by verb, then target id.
  A destroyed body has no options. An unknown actor is `no_such_entity`.
- **CLI:** an `options` op (`actor`, `refused?`), response schema in `src/contract.ts`; `docs/api.md`,
  `CLAUDE.md`.
- **Tests** (`tests/options.test.ts`): in a lit room with a chest, a lantern and a stone in reach: `take` the
  stone, `open` the chest, `light` the lantern are ready; a stone out of reach is blocked `out_of_reach` and
  absent without `refused`; `give`, `put`, `move`, `say`, `wait` appear in `needs_args`; in the dark the stone
  in reach is offered, nothing out of reach is (not even as blocked) and a hidden thing in reach is not;
  a destroyed actor has none; a store world and a memory world answer alike. The property
  test asks for the options of a random agent each step and applies one random `ready` option for real: it is
  `ok` (with the dice seeded, so a roll cannot refuse it).
- **Depends on:** nothing.

### Beat conditions on who is where

`limits-watch.md`: a beat's `only_if` reads one entity's prop, never who is present, so "the lights fail only if
someone is in the yard" cannot be said.

- **Two more forms** beside the prop comparison, all in `src/engine/beats.ts` (`parseCondition`, `holds`) and
  the `BeatCondition` union in `src/engine/command.ts`: `{ entity, in: <room> }` is true when the entity exists
  and its `location` is that room; `{ room, occupied: <boolean> }` is true when a live agent (not a destroyed
  body) being in that room equals `occupied`. A missing entity or room is false for both. A condition with keys of
  more than one form, or neither, is `invalid_args`; `beatInvalid` holds a stored one to the same shapes.
- **Docs and tests:** `docs/beats.md`; `docs/limits-watch.md` loses the line; `tests/scheduled-beat.test.ts`: a
  knock that only sounds when the yard is occupied, skipping with `condition` when bob has left; `in` follows an
  entity that was carried to another room; the generator sometimes uses the new forms and every step validates.
- **Depends on:** nothing.

