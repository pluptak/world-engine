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

1. [Scenery: things perceived that nothing can act on](#scenery-things-perceived-that-nothing-can-act-on).

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
  ordered batch, and two commands never share a tick.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

Every item is ready now and names anything it leans on; the order is under Priorities.

### Scenery: things perceived that nothing can act on

A scene needs things that are there to be perceived and change nothing: a flowery meadow, a painted
stain, the sky. The nearest today is `abstract` (`docs/state.md`), which is never perceived and no
agent can name. Scenery is its other half: perceived and named like anything, acted on by nothing.

- **Change:** a template prop `scenery: true` (`src/engine/fields.ts`, definition tier), read from
  the template as `abstract` is (`isScenery` beside `isAbstract` in `src/engine/resolve.ts`).
  - Perceived by the rules every entity follows: seen in a lit room, never in the dark; smelt only
    through residue or a liquid it carries, as anything is (`docs/limits.md`).
  - An agent's command whose resolved target is scenery is refused `scenery` in `pipeline.ts`,
    after resolution and before preconditions: a code the world owns, so no verb lists it, as with
    `no_seed`. The world author's verbs (`edit`, `advance`) are not refused: an edit and a process
    may still change it. `options` leaves scenery out of its targets, so it is never offered,
    blocked or suggested as an argument.
  - No footprint for movement: `walkStop`, `sweep`, `gapStop` and `occupantsIn` skip it as they skip
    an abstract entity, so a meadow is walked over and a shutting gate moves nothing of it; a bound
    is `barrier`, which exists.
  - A template that is `scenery` and also `agent`, `surface`, `container`, `openable` or
    `light_source` is refused when the set is resolved (`validateProps`): nothing could use those.
  - No template in `templates/` gains it: a new file there changes every world's hash.
- **Tests:** a new `tests/scenery.test.ts` with a `meadow` preset of its own registry: seen in a
  lit room and listed by `observe` and `inspect`, unseen in the dark; `take`, `push` and `attack` on
  it refused `scenery` with the snapshot unchanged; `options` lists none of it; an agent walks
  across it and a gate shuts over it without moving it; `edit` moves it and a process changes it;
  each forbidden pairing refused at load. The verb drift check in `tests/catalog.test.ts` passes
  with the world's code.
- **Docs:** `docs/state.md` (beside `abstract`), `docs/templates.md` (the prop and its refused
  pairings), `docs/verbs.md` (the world's refusal, beside `no_seed`).
- **Depends on:** nothing. **Not in it:** a smell or sound of its own (smell reads residue, sound
  is events); a sky seen from every room (it is placed in one); scenery as a holder.
