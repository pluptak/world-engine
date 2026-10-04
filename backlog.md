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
  the verb table in `tests/property-gen.ts`, the verb list in `docs/pipeline.md`, `CLAUDE.md` — take
  additions only, one line or one entry per change, so concurrent lanes conflict at most trivially.
- **No lane changes another lane's semantics.** If an item needs that, it stops and says so.

## Lane A. Relations and perception

Owns `src/engine/validate.ts`, `src/model.ts` (`Entity`), the perception part of
`src/engine/query.ts`, `docs/relations.md`, `docs/perception.md`, `docs/state.md`.

### A1. Relation invariants
- **Why:** relations are about to multiply (A2 next), and today their rules live partly in
  `validateSnapshot` and partly in individual verbs. Nothing in the validator says an entity is never
  both supported and contained; only `place` and `spawn` refuse that.
- **Scope:** one table in `docs/relations.md` for every relation — `support`, `contained_in`,
  `location`, `detached_from`, a door's `from`/`to`, a key's `opens` — stating whether it is
  exclusive with another, whether it may form a loop, whether it is live or history, and what
  happens when its target is removed or detached. Every rule in the table is enforced by
  `validateSnapshot` or by one named verb, and the property generator covers it.
- **Done when:** each row names its enforcing rule and a test; a snapshot with both `support` and
  `contained_in` set fails validation with its own code.

### A2. Concealment: `under` / `behind`
- **Why:** it exercises the boundary the engine exists for — what the world holds versus what can be
  perceived — and a consumer decides whether a character noticed.
- **Scope:** a `concealed_by: Id | null` relation, added to A1's table first. Sight of a concealed
  entity is `false` with its own basis until the observer searches the concealer (a `search` verb);
  moving the concealer reveals what it hid.
- **Done when:** a file under a book is not seen; after `search book` it is; lifting the book reveals
  it to everyone in the room.

## Lane B. Templates

Owns `src/templates.ts`, `src/engine/upgrade.ts`, new files in `templates/`.

### B1. Template `extends`
- **Scope:** `"extends": "bottle"` merges parent fields (props shallow-merged, parts replaced only
  if declared); cycles rejected; the hash covers the resolved templates, and the companion-template
  rule applies to the resolved set.
- **Done when:** `wine_bottle extends bottle` with only a changed `liquid_material` loads and breaks.

## Lane C. Materials

Owns a new `src/engine/verbs/pour.ts`; may call `src/engine/residue.ts` and
`src/resolvers/physical.ts` without changing their behaviour.

### C1. `pour` and liquid transfer
- **Scope:** liquid contents (`props.liquid_material/amount`) move into a container or become
  residue on a surface; partial amounts; emits `poured`.
- **Done when:** pour half a bottle into a cup → both amounts correct; onto the floor → residue.

## Lane D. Authoring space

Owns `src/scenario.ts`, the `place` path of `src/engine/verbs/edit.ts`, the `fact` part of
`src/engine/query.ts`, `docs/api.md`.

### D1. Authoring anchors without weakening spatial truth
- **Why:** worlds are easier to author as "by the door" than in centimetres, but "near" does not
  determine a position, and deriving one from it would be false precision.
- **Scope:** an `anchor` is a named reference point with real coordinates (no mass, no collision).
  A scenario or `edit place` may position an entity relative to an anchor with an explicit offset;
  the offset resolves to a stored `pos` when written, and nothing records the anchor afterwards — so
  anchors add no relation and stay out of Lane A's table. `near(x, y)` is a derived, queryable fact
  computed from geometry under a declared threshold; it never produces a position.
- **Done when:** a scenario authored against anchors runs the bottle chain unchanged, and
  `fact(table, near, door)` answers from positions.

## Lane Z. After A–D merge

### Z1. An authored adversarial scenario, then reassess
- **Why:** the property tests check invariants on random sequences; they do not show whether the
  model stays understandable when several systems interact in a world someone designed.
- **Scope:** a hand-written scenario (an inn room: table with bottle, chair, door, locked chest and
  key, two humans, a dog, a book hiding a note) and a scripted 30–100 command sequence that mixes
  support loss, breaking, carrying, locks, concealment, pouring, perception and edits, authored with
  names and anchors. Assert its full trace and perceivers at the key events.
- **Done when:** the sequence passes, and a short note in `docs/` records what it could not
  express — that list, not the project's name, decides whether richer physics is ever needed.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
