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
- The limits in `docs/limits.md`, reassessed after the inn: none is worth a verb yet. Facing and a
  sight cone (an unseen act in a lit room) is the costliest and the first to revisit, when a
  concrete world needs what darkness, concealment and staging cannot give.

## Items

Every item is ready now, and names anything it leans on; they can be taken in any order.

### A stored world verifies against its own log

A deterministic store should be able to prove it: replay the log from `initial.json` and see that the files agree.
`load` replays only when the head and the files disagree, and `upgradeTemplates` proves a template change that way,
but a caller cannot check a world after an engine change, a restore or a hand edit.

- **API:** `World.verify()` on a store world answers `{ ok: true, entries, version }` or
  `{ ok: false, divergence: { file, line, code } }`, the first difference between what the log replays to and what
  is stored. `file` is `snapshot.json`, `events.jsonl`, `deltas.jsonl` or `log.jsonl`; `line` is 1-based (0 for the
  snapshot); `code` is `differs`, `missing`, `extra`, or `status_differs` (a log entry whose re-decided status or
  reason code is not the recorded one). It reuses `replayFold` in `src/store/file-store.ts`, extended to compare each
  entry's recorded outcome, and compares canonical bytes. It writes nothing and holds the world's turn while it
  reads, since a writer half done would read as a divergence. A memory world answers `history_unavailable`. The CLI's
  `verify` op takes `world`; `VerifyResponseSchema` is in `src/contract.ts`.
- **Tests** (`tests/verify.test.ts`): a world after a mixed run (accepted, refused, invalid and preempted commands,
  edits, past a checkpoint at 256) verifies ok; one changed byte in `snapshot.json`, a deleted event line, an extra
  delta line and a log line with its status changed each report their divergence; a changed template set is
  `templates_changed` as elsewhere; no file's bytes change.
- **Docs:** `docs/persistence.md`, `docs/api.md`, `CLAUDE.md` (the store sentence).
- **Depends on:** nothing.

### The CLI describes its requests and responses

`verbs` and `capabilities` tell a caller what the engine can do; the shape of the CLI's own JSON is known only from
`src/contract.ts`. A caller in another language, or one generating tool definitions, has to read TypeScript.

- **Contract:** `RESPONSES: Record<Op, ZodType>` in `src/contract.ts`, the schema each op answers with, and
  `ResponseSchema` built from its values (the union stays the CLI's check on every answer).
- **Op:** `{ "op": "schema" }` answers `{ json_schema: "2020-12", request, responses }`: `z.toJSONSchema` (zod 4,
  which converts all 36 schemas in the contract today) of `RequestSchema` and of each entry of `RESPONSES`, keyed by
  op. `SchemaResponseSchema` joins the union.
- **Tests** (`tests/contract.test.ts`): every op of `RequestSchema` has exactly one entry in `RESPONSES` and none is
  dead; the answer is the same twice (`canonicalJson`); `request` has one branch per op and `responses.command`
  names the statuses `StatusSchema` does; a real answer for each op the CLI tests already issue parses with its own
  entry.
- **Docs:** `docs/api.md` (the CLI's ops).
- **Depends on:** nothing.

### Readers take whole lines

`since`, `attempts`, `trace` and the event-form `query` read `events.jsonl`, `deltas.jsonl` and `log.jsonl` without
the world's turn ([docs/locking.md](docs/locking.md)), so a read that overlaps a writer's append can find a last line
without its newline. `cachedLines` already declines to cache such a file but still parses the fragment, which
throws a bare `SyntaxError`; `readLogEntries` and the replay start split the same way.

- **Store:** in `src/store/file-store.ts`, `parseLines`, `readLogEntries` and the tail of `replayStart` take only the
  text up to the last newline; what follows is not yet a line and is left for the next read. A file that is all
  fragment reads as empty. The cache records the bytes it consumed, so it keeps its entries instead of dropping them.
- **Tests** (`tests/store-lines.test.ts`, calling the readers directly): each file with a half-written record at its
  end reads as without it, twice in a row; once the record is completed the next read has it, the cache extended and
  not rebuilt; a malformed line before the end still fails with its line number.
- **Docs:** `docs/locking.md` (what a read without the turn sees), `docs/persistence.md`.
- **Depends on:** nothing.
