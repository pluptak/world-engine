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

## Lane A. Relations and perception

Owns `src/engine/validate.ts`, `src/model.ts` (`Entity`), the perception part of
`src/engine/query.ts`, `docs/relations.md`, `docs/perception.md`, `docs/state.md`.

### A3. Perception spec: what each sense perceives
- **Why:** today, in the same room, every event is audible and smellable whatever it is (smelling a
  `search` or an `opened`), and the world author's own edits are perceived like physical events.
  Z1 asserts perceivers, so these answers must be specified before it relies on them.
- **Scope:** one table in `docs/perception.md`: per sense and event type, perceptible in the same
  room, through an open door, through a closed one; `query.ts` and `eventPerceivers` enforce it.
  Defaults: sight as now; hearing every physical event in the room, loud ones through a doorway;
  smell only events that release a smell (a pour, a broken wine bottle), where coverage declares
  it; the world author's `edit`, `placed`, `edited`, `removed`, and a `spawned` the edit itself
  caused, are not perceptible, but their physical consequences (a fall, a break) are.
- **Done when:** a test walks the table row by row, and an edit that knocks a bottle off a table
  lists perceivers on the fall and the break but none on the edit itself.

## Lane Z. After A3 merges

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
