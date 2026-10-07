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

### Options: what an agent can do now

A middleware choosing an agent's next action has to try verbs to learn which are possible. `check` dry-runs one
command; nothing lists the commands that would work. (The scope line allows describing and dry-running
commands; choosing among them stays the middleware's.)

- **API:** `world.options(actor, { refused? })` returns `{ actor, version, ready, needs_args, blocked? }`.
  Candidates are every verb in the catalog that is not `author_only`, against each entity the actor can
  address (`addressable` in `src/engine/query.ts`, the rule target resolution applies, which never
  names a hidden thing, so none is offered), excluding the actor, and once with no
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
