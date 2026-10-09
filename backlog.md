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

1. [An actor names things by its own aliases](#an-actor-names-things-by-its-own-aliases).

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

### An actor names things by its own aliases

Event and entity ids come from one `next_seq`, so an actor told `ev12` and then `ev20`, or shown a
new `e45` after `e30`, knows ids were allocated out of its sight. The actor view stops sending real
ids: each actor gets its own alias for every entity and event id, a hash, so it carries no count and
needs nothing stored. This hides the count from a controller that reads its views, as an LLM does;
it is not proof against one that hashes candidate ids to decode them, and a secret key can come
later if a caller needs that.

- **Change:** `aliasOf(actor, id)` in `src/actor-world.ts`, exported: `x` and the first 12 hex
  digits of the SHA-256 of `<actor>:<id>` (`node:crypto`, as `templates.ts` uses); a part address
  keeps its part (`<alias>.hand_l`). The actor's own id is aliased too.
  - **Out:** `actorWorld` maps every id field its types carry, field by field (a string walk would
    rewrite a spoken token that looks like an id): the projection's `observer`, each entity's `id`
    and its facts' references, each event's `event_id` and `entity`; an inspection's `id`, `facts`
    and `holds`; the options' `actor`, targets and id-valued args; a verdict's `resolved_target`,
    `candidates` and id-valued `reason_data`. A projection lists entities in alias order, so not in
    the order they were made; events stay in the order they happened.
  - **In:** a target or an id-valued arg (`destination`, `location`, `to` where it names one) that
    is one of this actor's aliases is mapped back by aliasing the snapshot's entity ids; anything
    else (a name, an alias, a position) passes as now. An alias of another actor resolves to
    nothing.
  - The CLI's `actor_*` ops answer through the view, so they follow; `actor` stays the real id the
    trusted caller was given. `src/contract.ts`: the id patterns of the actor responses accept an
    alias.
- **Tests:** `tests/actor-world.test.ts`: no real entity or event id appears anywhere in what an
  actor is sent; two actors' aliases for one entity differ; a command naming an alias acts on that
  entity, and one naming another actor's alias is `unresolved`; the unseen-act test of the version
  item extended so the two worlds also differ in how many ids were allocated (bob takes the stone,
  or waits), and ann is sent the same. `tests/actor-harness.ts` (`assertNoUnknownIds` recognises
  aliases), the actor scenarios and `tests/cli-actor.test.ts` map world ids through `aliasOf` where
  they compare.
- **Docs:** `docs/actor-view.md` (aliases, their limit), `docs/limits-actor.md` if a step's line
  names an id.
- **Depends on:** nothing. **Not in it:** a secret key; aliasing in the trusted `World`, its CLI
  ops or the store.
