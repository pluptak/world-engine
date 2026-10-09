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

1. [An actor view carries no version](#an-actor-view-carries-no-version).

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

### An actor view carries no version

`version` counts the world's accepted commands, so an actor that sees it jump while it sensed
nothing learns that others acted unseen: `Projection.version` in `actor_observe` and every
`actor_command`'s `observation`, and `Options.version` in `actor_options`. `based_on_version` lets
an actor send a stale command, whose `preempted` says the world changed out of its sight. An actor
marks where it last looked by the tick instead, which is time it feels pass, not a count of anyone's
commands.

- **Change:** `World.observe` takes `since_tick` as well as `since` (one or the other, both is
  `invalid`): the events at that tick or later that the observer sensed, through event-form
  perceive as now; a store world filters `events.jsonl` by `tick`, a memory world its records,
  which throws `history_unavailable` for a tick before it started. `actorWorld` answers an
  `ActorProjection` (`Projection` without `version`, with the snapshot's `tick`) from `observe` and
  in `command`'s `observation`, whose events are its own command's (by version, inside, as now);
  `observe` takes `since_tick` only. `options` drops `version`. `command` takes no `basedOn`, so
  every actor command is decided against the current version and is never `preempted`. The CLI's
  `actor_observe` takes `since_tick` in place of `since`, `actor_command` drops
  `based_on_version` (sent, it is `invalid` with `unrecognized_keys`), and `src/contract.ts` gains
  `ActorProjectionSchema` and an actor options schema for `RESPONSES`. Events at the tick of the
  last look come again; a controller keeps them apart by `event_id` (the harness does).
- **Tests:** `tests/actor-world.test.ts`, `tests/cli-actor.test.ts`, `tests/actor-harness.ts` (its
  marker is `observation.tick`, deduplicating by `event_id`) and the actor scenarios move; new
  cases: no actor result, check, options or projection has a `version` key; `actor_command` with
  `based_on_version` is `invalid`; `observe({ since_tick })` matches a store and a memory world
  byte for byte; and two worlds that differ only in an unseen act, bob in the dark cellar taking
  the stone or waiting one tick (pick the pair so both allocate the same ids), give ann the same
  actor results and projections, canonicalJson for canonicalJson.
- **Docs:** `docs/actor-view.md` (the marker, the dropped fields, the duplicate events),
  `docs/projection.md` and `docs/api.md` (`since_tick`), and the residual below.
- **Depends on:** nothing. **Not in it:** ids come from `next_seq`, so a gap in event or entity ids
  still shows that something was allocated unseen; that stays a candidate.
