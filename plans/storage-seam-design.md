# Storage seam groundwork — design

Date: 2026-10-11. Scope: interface-only groundwork so a SQLite backend
can be added later. No SQLite code, no behavior change.

## 1. Intent

`src/api.ts` builds `World` twice: `storeWorld` over a directory and
`memoryWorld` over in-memory locals, with duplicated folds. `src/store/
file-store.ts` exports `dir`-coupled functions (`load`, `submit`,
`since`, `trace`, `replayFold`, `replayUntilEvent`, `verify`,
`entryCount`, …) that `~15` test files import directly. There is no
seam to swap (only `PendingStore` in `src/internal.ts` shows the
pattern). Goal: one `World` driver over a `WorldStore` interface, with
the file layout and the memory behavior behind it, byte-identical.

## 2. Constraints (agreed)

- Zero behavior change: same files, same `canonicalJson` bytes, same CLI.
- Frozen: on-disk format (`initial/snapshot/log/events/deltas/head/
  checkpoints/lock`, `schema_version 5`) and `file-store.ts` test
  imports keep working as thin wrappers.
- Pure core untouched (`engine/` decides, store persists); no new
  dependencies (AGENTS.md: TS + `tsx` + `@types/node` + `zod` only).
- One pausable block; starts after the dirty roles/successor work
  commits; stages only its own files.

## 3. Approaches considered

- A/minimal mirror: interface mirrors current `file-store` signatures.
  Smallest diff, but leaks file concepts (`head` sizes, `lock`) that a
  SQLite impl would have to fake. Rejected.
- B/log-oriented (chosen): primitives on the interface, shared folds
  above it. SQLite later maps to tables instead of faking files.
- C/read-write split (CQRS): cleanest long-term, but splits `World`,
  churns CLI/tests, too big for one block. Rejected.

## 4. Architecture

New `src/store/store.ts` defines `WorldStore`. `src/store/file-store.ts`
becomes `FileWorldStore` implementing it; file quirks (`head.json`
sizes, `checkpoints/`, `src/store/lock.ts`) stay inside. New
`src/store/memory-store.ts` holds `MemoryWorldStore`, extracted from
`api.ts` `memoryWorld` locals (`current/events/applied/history/tried`).
`src/api.ts` `storeWorld`/`memoryWorld` become one driver over
`WorldStore`. Existing `file-store.ts` exports remain as wrappers
delegating to a `FileWorldStore`, so disk format and test imports are
frozen. No SQLite code in this block.

## 5. Components

`WorldStore` carries primitives only, no folds: `readSnapshot/
writeSnapshot`, `appendLog/readLog`, `appendEvents+appendDeltas/
readEvents/readDeltas`, `readCheckpoint/writeCheckpoint/
clearCheckpoints`, `readTemplates/writeTemplates`, `readIds`,
`runExclusive<T>(body)` for the turn. New `src/store/folds.ts`
implements the shared folds over `WorldStore`: `replayFold`,
`replayUntilEvent`, `since`-fold, `trace`-fold, `verify`-compare,
`entryCount`/`roundNumber`. `resolveSubmission` stays in `engine/`;
the store persists its inputs/outputs. `PendingStore` is extended
(file `pending.json` vs memory `Map`), not changed.

## 6. Data flow and errors

`submit` order is unchanged: engine decides, then `appendLog`,
`appendEvents/appendDeltas`, `writeSnapshot`, checkpoint, `head` last.
Memory mirrors with arrays; its `runExclusive` is a no-op. Crash
semantics frozen: partial line without newline ignored, `head`-size
mismatch rebuilds from the log, stale-lock takeover stays file-only
inside `FileWorldStore`. `WorldError` codes unchanged (`store_busy`,
`templates_changed`, `replay_diverges`, `unsupported_schema`,
`no_such_world`); no new codes.

## 7. Testing and rollout

Gate: `npm run check:changed` (typecheck + reachable tests) plus
deliberately breaking the one new seam test, then restoring it.
Byte-identity is proved by the unchanged `verify`/`file-store`/`since`/
`trace`/`bench` suites plus one new seam test asserting the file and
memory drivers fold identically over a scripted log. Files touched:
`src/store/store.ts` (new), `src/store/folds.ts` (new), `src/store/
memory-store.ts` (new), `src/store/file-store.ts` (wrappers +
`FileWorldStore`), `src/api.ts` (single driver). No backlog item
consumed; no CLI changes. A later SQLite block adds
`SqliteWorldStore` implementing `WorldStore`, reusing `folds.ts`.

## 8. What SQLite later looks like (not in this block)

Tables for snapshot, log, events, deltas, checkpoints, templates/ids;
`runExclusive` becomes a SQLite transaction (replacing the `lock`
file); `verify` reuses the shared compare. Migration of existing
worlds is out of scope until a scenario needs it.
