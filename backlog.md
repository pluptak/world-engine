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

## Lane Z. After every lane has merged

### Z2. Parts as holders
- **Why:** hands are not a budget (`docs/limits.md`): a carrier's things are all `contained_in` the
  carrier, so ann holds any number of one-handed items, and nothing tells a hand from a pocket.
- **Scope:** `contained_in` may name a part (`ann.hand_r`), and a template may declare a part a
  holder: a hand holds one item, a two-handed item takes both hands, and a `pocket` or `pack` part
  has inner dimensions like a chest's. `take`, `give`, `put`, `drop` and drop-on-loss address the
  part; `location` derives through it. A row in `docs/relations.md` says what detaching or
  destroying a holding part does to what it holds.
- **Done when:** a human with a bottle in each hand is refused a third item with its own code;
  losing a hand drops exactly what that hand held; a pocketed item survives it.

### Z3. Touch: an agent feels its own body
- **Why:** an agent cannot perceive what happens to it in the dark, and theft cannot be told apart
  from the room seeing it: perception has no sense for one's own body.
- **Scope:** a `touch` sense, declared by coverage, in the sense table as rows: an agent feels
  events on itself and its parts (`damaged`, `detached`, `capability_changed`) and an item leaving
  its hand, but not one leaving a pocket or pack. Nobody else feels them. What pain makes it do is
  the caller's business.
- **Done when:** ann in an unlit room is a touch perceiver of her hand's `detached`; an item taken
  from her hand lists her under touch, one taken from her pocket does not; A3's guard still holds.

### Z4. Reassess
- What the inn could not express: `docs/limits.md` lists the limits left, each with the step that
  shows it. After Z2 and Z3, take the rest one at a time, or say why none of them is worth a
  verb. Facing and a sight cone (an unseen theft in a lit room) are a candidate, the costliest one.

## Lane Y. Beside Z2

Files Z2 does not touch, so these run in parallel with it; each merges on its own.

### Y1. Coverage from the CLI, and the unknown sense
- **Why:** a world built by `init` always declares the default coverage, so it can never smell
  (`docs/limits.md`); and `unsupported_sense`, the answer for a covered sense the engine has no
  rules for, has no test.
- **Scope:** `init <dir> <scenario.json> [coverage.json]`, validated by the contract's schema and
  passed to `createWorld`; a test that a coverage declaring `taste` answers `false` /
  `unsupported_sense`.
- **Done when:** a world made by `init` with smell in its coverage answers smell from the CLI.

### Y2. A vessel that falls spills
- **Why:** the inn's cup fell 75 cm off a removed table and kept its 30 cm³, because only a break
  releases liquid (`docs/limits.md`).
- **Scope:** in the fall path of `src/resolvers/physical.ts`, a vessel holding liquid that falls
  without breaking and is not shut spills all of it as residue on its landing, under a `spilled`
  event; the sense table gets a `spilled` row, smelled like a pour.
- **Done when:** the inn's cup ends empty with the floor carrying its liquid; a shut vessel keeps
  its liquid; a break still releases through its own path, never twice.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
