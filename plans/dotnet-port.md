# .NET port — plan for the full port

**Status (2026-10-13): complete.** Every block below has landed, no `NotPortedException` is left in the engine, and the replays in `plans/ts-sunset.md` show no unexplained difference from TypeScript. What remains is the sunset plan's Phase 4 docs and Phase 5.

Date: 2026-10-12. Scope: port the TypeScript world engine (`src/`, 69 modules, 17,880 lines) to .NET 10
under `dotnet/`, on branch `dotnet-skeleton`. TypeScript stays the reference: every ported piece is
checked against golden output generated from it, never against the .NET author's reading of the spec.

> Superseded by `plans/ts-sunset.md`: the port is complete and TypeScript is frozen. From the end of Phase 2 of that plan the .NET engine and
> its goldens are the reference, and a golden changes only with a deliberate change to .NET behaviour.

## 1. Where things stand

Measured on commit `7ff0464`.

- **Ported (pure core):** every verb module (`src/engine/verbs/*`, 18 files, `address` through `wait`),
  `pipeline` (without rounds and per-event perceivers), `clock`, `geometry`, `carry`, `capacity`,
  `fields`, `parts`, `fit`, `harm`, `power`, `residue`, `resolve`, `rng`, `spawn`, `validate` (the
  reachable rules), `canonical`, `command`/`model`, `resolvers/physical`, and the template loader and
  resolver.
- **Partly ported:** `query.ts` (928 lines: perception and event perception are in, `fact` and the
  rest are not), `schedule.ts` (141: `close` and `bleed` only), `verbs/edit.ts` (1,190: spawn, remove,
  place, props, part and seed, plus anchor placement; not beat, run, role or refine), `templates.ts`
  (999: loader and resolver, not `refine` lineage or the upgrade path).
- **Not started (26 modules, 7,373 lines):** `api.ts` (1,090), `store/file-store.ts` (1,674),
  `contract.ts` (844), `cli/main.ts` (367), `actor-world.ts` (341), `engine/projection.ts` (328),
  `engine/beats.ts` (497), `engine/process.ts` (212), `scenario.ts` (210), `store/lock.ts` (222),
  `player-world.ts` (194), `engine/scene.ts` (249), `engine/catalog.ts` (131), `options.ts` (129),
  `engine/forms.ts` (137), `engine/run.ts` (120), `director-world.ts` (112), `engine/refine.ts` (110),
  `engine/trace.ts` (107), `engine/upgrade.ts` (86), `engine/round.ts` (66), `internal.ts` (40),
  `engine/pending.ts` (47), `errors.ts` (44, partly reflected in `NotPortedException`), `engine/capabilities.ts`
  (38), `engine/compare.ts` (9), `index.ts` (13).
- **Known refusals inside ported code** (each throws `NotPortedException` or is absent, so none is
  silently wrong): beat, run and role edits and `refine` in `edit`; `advance`'s `stop_before`; process
  and beat schedule causes; per-event perceivers and rounds in `Pipeline.Apply`; validation rules for
  runs, beats and processes; an explicit `in_part: null` on a spawn; non-string trait values on a spawn.
- **Tests:** 107 xUnit tests, all passing. Goldens live in `dotnet/tests/WorldEngine.Tests/Fixtures/`
  and are regenerated from TypeScript by the scratchpad generators in `gen/`.

## 2. What "full port" means

Done when all of these hold:

1. **Engine parity.** Every `src/engine/*` behaviour is ported, including beats, runs, processes,
   rounds, projection, trace, refine, upgrade and scenes. The known refusals above are gone.
2. **Store parity on disk.** The .NET store reads and writes the same files as TypeScript
   (`initial.json`, `snapshot.json`, `log.jsonl`, `events.jsonl`, `deltas.jsonl`, `head.json`,
   `checkpoints/`, `lock`), `schema_version` 5. A world created by either implementation opens in the
   other, and `verify` passes on both. Byte-identical canonical JSON is the test.
3. **Surface parity.** The CLI accepts the same JSON requests (every `op` in `src/cli/main.ts`) and
   returns the same responses, validated against the same response schema.
4. **Acceptance parity.** The TypeScript acceptance and `scenario-*` tests have .NET counterparts, and
   the same command sequences produce the same logs, events, deltas and snapshots.

Out of scope unless you say otherwise: the TypeScript `npm` package surface (`exports`) and the
`candidates.md` gaps, which are unplanned on both sides.

## 3. Approach

- **Block discipline (unchanged):** each block is one module or one coherent slice. Start → port →
  golden → tests → mutation check (change one golden value, see the failure, restore) → full suite →
  report → commit on instruction. Only own files are staged, by path. Never push.
- **Golden first, per block:** a generator in `scratchpad/gen/` runs the TypeScript code on a fixture
  world and writes the expected output. The .NET test compares canonical JSON (or code and path lists
  for validation). A block does not start until its generator exists.
- **Order follows dependencies, not file size.** Pure engine pieces come before anything that reads
  the store; the store comes before the facade; the facade before the CLI.
- **Shared fixtures are frozen.** A change to `base-world.mjs` regenerates every golden that uses it, so
  such a change is its own block.
- **Replace Zod with typed records plus a schema check.** `contract.ts` defines the JSON boundary. The
  .NET side uses records with explicit validation, and the `schema` op emits JSON Schema generated
  from the same definitions. The schema output is golden-compared.

## 4. Blocks

Sizes are TypeScript lines, a rough guide. Each block lists the TypeScript it covers.

### Phase A — finish the pure engine (about 3,000 lines)

1. **Edit: refine and lineage** (`verbs/edit.ts` refine, `engine/refine.ts`, `templates` lineage).
   Needs the lineage kept on resolved templates. Golden: refine ok and each refusal.
2. **Read-only helpers** (`engine/pending.ts`, `engine/forms.ts`, `engine/catalog.ts`,
   `engine/capabilities.ts`, `engine/compare.ts`). Small, no state; golden by direct calls.
3. **Processes** (`engine/process.ts`, 212). Process schedule causes, `chance_pct` via the rng,
   `then` (set, hurt, removeEntity, spendEntity), reconciling against touched entities.
   Clears the process gap in `schedule.ts`.
4. **Beats** (`engine/beats.ts`, 497). Beat schedule causes, `schedule_beat`, `cancel_beat`,
   `retime_beat`, `play_beat`, and `advance`'s `stop_before`. Clears the beat gap.
5. **Runs and scenes** (`engine/run.ts`, `engine/scene.ts`, `scenario.ts`). `start_run`, `end_run`,
   `register_player`, `steer`, and the scene builder. Clears the run and role edit gaps.
6. **Pipeline completion** (rounds in `engine/round.ts`, per-event perceivers in `Pipeline.Apply`).
   Clears the pipeline gap and the run and beat validation rules.
7. **Query completion** (the rest of `engine/query.ts`: `fact`, `inReach`-style reads).
8. **Projection and trace** (`engine/projection.ts` 328, `engine/trace.ts` 107).
9. **Upgrade** (`engine/upgrade.ts`, 86): template changes against existing worlds.
10. **Verb registry and options** (`verbs/index.ts` as a catalog, `options.ts` 129): dry-runs and the
    verb catalog, which must throw on an undeclared refusal code, as TypeScript does.

### Phase B — roles and views (about 700 lines)

11. **Internal and actor view** (`internal.ts`, `actor-world.ts`): one actor's projection, results
    without the world's record.
12. **Player and director handles** (`player-world.ts`, `director-world.ts`).

### Phase C — storage (about 2,000 lines)

13. **Store interface and memory store** (`store/store.ts` in TypeScript, per
    `plans/storage-seam-design.md`, once that block has landed in TypeScript). `WorldStore` with the
    memory implementation; golden for behaviour unchanged.
14. **Lock** (`store/lock.ts`, 222): exclusive file create, dead-process and age takeover, timeout as
    `store_busy`. Test with two processes; the TypeScript `store-lock` test is the reference.
15. **File store, read path:** `load`, head checking, the replay fold, `since`, `trace`, store queries
    over `events.jsonl`, checkpoints. Golden: a world written by TypeScript opens in .NET with the same
    snapshot and events.
16. **File store, write path:** `submit` (log lines for every command including refused ones, deltas,
    events, snapshot every 32 accepted commands, `head.json` last), `edit`'s default ids, `verify`,
    the repair in `load`. Golden: the same command sequence writes byte-identical files.
17. **Stale commands:** `based_on_version` re-evaluation and `preempted`.

### Phase D — facade and surface (about 1,500 lines)

18. **World facade** (`api.ts`, 1,090): `command`, `edit`, `check`, `options`, `since`, `attempts`,
    `query`, `observe`, `inspect`, `snapshot`, `entity`, `catalog`, `schedule`, `round`. Memory and
    file worlds behind one driver.
19. **Contract** (`contract.ts`, 844): the request and response types, and `RESPONSES`. The `schema`
    op's JSON Schema is golden-compared.
20. **CLI** (`cli/main.ts`, 367): one block per op group (command and edit; read ops; actor and
    player and director ops; `init`, `verify`, `schema`). Each op's request and response golden.

### Phase E — parity (no new code expected)

21. **Acceptance parity:** run the TypeScript acceptance and `scenario-*` sequences through the .NET
    CLI; compare logs and files byte for byte.
22. **Cross-implementation checks:** a world from each side opens and verifies in the other.

## 5. Risks

- **Canonical JSON drift.** Any difference in number, key order or escaping breaks every golden at
  once. `CanonicalJson` already has its own test file (`CanonicalJsonTests.cs`); keep it green before any block.
- **Replay order.** Store replay must fold events and deltas in the same order as TypeScript, or
  checkpoints differ. Golden at block 15 must cover a world with refused commands in the log.
- **Lock behaviour across processes.** Unit tests cannot show takeover; use a two-process test.
- **Template hash.** The `templates_hash` covers every template; any resolver difference changes it.
  The loader is ported, but the hash over `refine` lineage (block 1) must be checked against TypeScript.
- **Scope creep from `candidates.md`.** New behaviour (conditions, facing) is not part of the port. Port
  the current TypeScript, nothing more.

## 6. Decisions needed

Decided (the user, when Phase D began): 1. replacement or interoperation: **interoperate**, reading and writing TypeScript's files byte for byte (every golden so far relies on it). 2. contract: **typed records with a generated JSON Schema**, replacing Zod. 3. goldens: **regenerated in the same change** as any TypeScript change that alters output.

The questions as the plan first asked them:

1. **Replacement or interoperation?** This plan assumes .NET must read and write TypeScript's files
   (Phase C), not just match its engine. If .NET is only an engine port, Phases C to E shrink to the
   memory store and the engine surface.
2. **Contract approach.** Replacing Zod with typed records and a generated JSON Schema (step 19) is my
   recommendation. The alternative is to keep JSON Schema hand-written and compare it.
3. **Who keeps the goldens current** while TypeScript changes? Each TypeScript change that alters
   output needs a regenerated golden in the same block, or the .NET suite drifts.
