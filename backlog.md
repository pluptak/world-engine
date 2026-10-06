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
