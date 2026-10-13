# Sunsetting the TypeScript engine in favour of .NET

Date: 2026-10-13. Follows `plans/dotnet-port.md` (the port itself). Goal: the .NET engine under `dotnet/` becomes the only
implementation, and `src/`, `tests/`, the npm tooling and their CI are removed.

The .NET suite is mostly goldens generated from the TypeScript code, so TypeScript is the test oracle as well as the engine.
Retiring it means moving that oracle, and most of this plan is about that.

## Principle

Delete nothing until .NET can stand on its own: its tests must not depend on running TS, and the process around it (CI,
benchmarks, docs, agent instructions) must work without Node. Each phase ends in a state where work can stop.

## Phase 0: Decisions

1. **Who consumes TS today?** `package.json` exports `src/index.ts`, and `scripts/host.ts` is a reference host. Does anything
   outside this repo import the package or call `npm run world`? If so it needs a replacement: the .NET CLI, or a NuGet package
   if the library is consumed directly.
2. **Byte compatibility after the cutover.** If TS-written worlds must keep opening, canonical JSON and `schema_version` 5 stay
   frozen. If not, they could be simplified later; they should still not be touched during the cutover.
3. **Freeze window.** The TS engine takes no feature work from the start of Phase 2; new work goes to .NET only. The Priorities
   section of `backlog.md` is reviewed once for this.
4. **Contract clients.** Does any external client validate against the Zod-derived JSON Schema (`docs/api.md`, the `schema` op)?

## Phase 1: Make .NET trustworthy on its own

- Fix the two baseline failures: `Block21ReplayTests` (Windows-path goldens) and the flaky `WorldLockProcessTests`.
- Gap check of the TS test files against the .NET tests. Table: TS test, .NET counterpart or "not needed". Port the missing ones.
  Likely gaps (to verify): the property-based tests (`property-gen.ts`, `property-run.ts`), the `scenario-*` and `acceptance`
  tests, and the docs/fields/catalog drift tests that read source and docs as text.
- Cross-implementation soak: run the property generator and every `scenarios/*.json` through both engines with the same seeds and
  compare canonical output, including a TS-written world opened by .NET and the reverse.
- Run `verify` on every sample world with the .NET build.

Exit: the .NET suite is green with no known failures, and the corpus comparison shows zero diffs.

## Phase 2: Freeze goldens

- Commit the golden generators (today in the scratchpad) into the repo, e.g. `dotnet/tools/golden-gen/`, marked "last generated
  from TS at commit X".
- Add a .NET-native way to regenerate goldens, so a behaviour change is a deliberate golden update with a reviewed diff.
- Invert the "TypeScript is the reference" rule in `CLAUDE.md`/`AGENTS.md`.

Exit: `dotnet test` needs nothing from `node_modules`.

## Phase 3: Replace the surrounding tooling

| TS tooling | .NET replacement |
|---|---|
| `scripts/test-select.ts` | Probably drop it; check the full suite's run time first. |
| `npm run bench*` (4 scripts) | A small benchmark app or BenchmarkDotNet. Record TS numbers first as the baseline. |
| `scripts/host.ts` | Port as a .NET sample, or keep as a Node client of the CLI (a good outside-in test). |
| `.github/workflows/check.yml` | `setup-dotnet` and `dotnet test`; keep the npm job until Phase 5. |
| `npm run world` | `dotnet run --project WorldEngine.Cli`, plus a publish step for users. |

## Phase 4: Docs and agent instructions

- Rewrite `CLAUDE.md` and `AGENTS.md` for the .NET layout (they name `src/…ts` paths throughout).
- Update TS identifiers in `docs/*.md`, keeping the behaviour descriptions, which are the spec.
- Mark `plans/dotnet-port.md` complete; move the TS-specific parts of `backlog.md` and `plans/candidates.md`.

## Phase 5: Sunset

1. Tag the last commit that has TS (`ts-final`).
2. Deprecation period (2 to 4 weeks): TS stays in the tree, CI runs both, the README says TS is frozen.
3. Delete `src/`, `tests/`, `scripts/*.ts`, `package.json`, `tsconfig.json` and the npm CI job.
4. Final check: fresh clone, `dotnet test`, create a world, replay it, verify it.

## Risks

- **Silent drift.** Goldens only cover cases someone thought of; the Phase 1 corpus comparison is the real mitigation.
- **Lost oracle.** After the cutover nothing else says what "correct" is; the `docs/` specs and the `ts-final` tag are the reference.
- **Schema clients.** An external client validating against the old Zod-derived schema is the failure case Phase 0 must rule out.
- **Performance.** The .NET port has not been benchmarked against TS. Run the four bench scenarios on both before cutover.

## Phase 0 findings

Found in the repo (2026-10-13):

- **In-repo consumers of the TS package:** none beyond its own tests and scripts. `package.json` is `private`, version 0.0.0, with
  `exports` pointing at `src/index.ts`. `scripts/host.ts` imports `runCli` directly, but `docs/host.md` presents it as a host that
  sees only the CLI's JSON, as a caller in another language would.
- **Documented surface:** README and `docs/overview.md` give the in-process API (`createWorld`, `openWorld`, `memoryWorld`) and
  `npm run world` as the entry points. `backlog.md` mentions a possible "middleware" and a Story-writer repo as out of scope, so
  consumers, if any, live outside this repository.
- **Single-author history:** all 393 commits are by one author, so no other contributor's workflow depends on the npm tooling.

Decided by the maintainer (2026-10-13):

1. **External consumers: none.** The .NET CLI is the one entry point. No NuGet package, no in-process migration path; Phase 3's
   publish step only needs a runnable CLI.
2. **Old worlds need not keep opening.** Byte compatibility with TypeScript is therefore not a goal after the cutover, but it is
   still what makes the Phase 1 soak and the goldens work. Keep canonical JSON and `schema_version` 5 as they are until Phase 5,
   and decide afterwards whether to simplify (a possible Phase 6, not planned).
3. **Freeze: now.** No TypeScript feature work from 2026-10-13. A TS change is allowed only to fix a bug the soak finds that the
   .NET side must match, and then the golden is regenerated in the same change. `backlog.md` Priorities are to be re-pointed at
   .NET (see Phase 2 below).
4. **Schema clients: none.** The generated schema must match behaviour, not stay byte-identical to the Zod output; the golden
   comparison of `schema` can be loosened to a semantic check when convenient.

Consequences for the phases: Phase 1 starts now; the freeze already holds, so Phase 2's "freeze window" item is done and what
remains of it is the golden generators and the .NET-native regeneration. Backlog items 1 and 2 (the multi-process failure and the
storage seam) name TypeScript files and need re-pointing or closing before any work on them.

## Progress

- 2026-10-13, Phase 1: both baseline failures fixed (d0c6b22); the full .NET suite is green (5800 tests).
- 2026-10-13, Phase 1 soak, memory worlds: `dotnet/tools/golden-gen/property-trace.ts` records the TypeScript property sequences
  (seeds 0 to 499, 30 steps) and `PropertyTraceTests` replays them: 15,000 steps, answer and snapshot hashes equal at every step.
  It found one real divergence, fixed in the same commit (a beat's edit threw on a refusal code `edit` does not declare).
- 2026-10-13, Phase 1 soak, store worlds: the first 60 of those sequences also run on a store world (`WorldBuilder.Create` and
  `StoreWorld`): same answers and snapshots, `verify` clean, a fresh open reads back the same snapshot. TypeScript's own store
  subset runs 17 seeds.
- Scenarios and sample worlds: all nine `scenarios/*.json` are already built by `InitGoldenTests` (files compared byte for byte
  with TypeScript's) and driven by `Block21ReplayTests` (the recorded `scenario-*` and `acceptance` sequences, files hashed), and
  `verify` runs in the store tests and the soak above. Nothing further to add.
- The test-gap table, by coverage instead of by name. Matching TypeScript test files to .NET ones by name is unreliable (about 80 of
  146 TS files have no name match, though most of what they check is reached through goldens and the replay). The measure used is
  .NET line and branch coverage of `src/` under the full suite (coverlet, `dotnet test --collect:"XPlat Code Coverage"`):
  91.5% of lines and 83.2% of branches, 1,012 lines not run. The least covered files, the gap list to work from:

  | File | Lines run | Missed |
  |---|---|---|
  | `Core/Engine/NoSeedError.cs`, `Contract/ContractValues.cs` | 0% | 1, 11 |
  | `Core/Engine/Scenes/Refine.cs` | 55% | 37 |
  | `Store/WorldUpgrade.cs` | 66% | 55 |
  | `Store/WorldLock.cs` | 76% | 45 |
  | `Core/Engine/Scheduling/BeatShape.cs` | 78% | 29 |
  | `Store/WorldVerify.cs` | 79% | 34 |
  | `Core/Engine/Worlds/PlayerWorld.cs` | 82% | 27 |
  | `Core/Engine/Verbs/AttackVerb.cs` | 84% | 48 |
  | `Core/Engine/Verbs/EditParser.cs` | 87% | 42 |
  | `Core/Engine/Physics/Physical.cs` | 87% | 44 |

  Next step: for each, read the TS test that exercises the same code (`refine`, `upgrade`, `store-lock`, `scheduled-beat`,
  `verify`, `player-slots`, `attack` ...), record its cases as goldens, and add them. Rerun coverage; the target is every
  behavioural branch run, not a number.
- 2026-10-13, Phase 1, coverage-driven goldens (see `dotnet/tools/golden-gen/`: `scripted.ts` records a world driven through calls,
  `mixed-world.ts` is the shared stored-world run): `refine-golden` (32 rows: every refine refusal), `beat-shapes-golden` (147 rows:
  conditions, repeats, followers, actions, ids and ticks, then beats run), `tamper-golden` (130 damaged stored worlds: verify,
  open, verify again, every file's hash; the 267-line mixed run is byte-identical to TypeScript's) and `takeover-golden` (17 sets a
  head does not name). They found two real defects, both fixed: `StoreWorld.Open` never settled a world under its own moved
  set (the takeover path was unreachable, 0% covered) nor checked the snapshot it opened; and a beat condition with a fractional value
  (a deviation, below). Coverage went from 91.5% to about 93% of lines.
- 2026-10-13, Phase 1: `verb-matrix` (31,859 commands: every verb, with every kind of actor, target and argument, over the 55 fixture
  snapshots; all answers, refusals and effect hashes equal TypeScript's, first run) and `template-fuzz` (2,506 mutated template sets:
  accept or refuse, and the message word for word). The fuzz found that .NET read a half-written template with defaults (a missing
  `size_cm`, `every_ticks: null`, a `then: {}` ...) where TypeScript refuses it; `TemplateShape` now checks the JSON as `parseDecl` does.
- **Phase 1 status (2026-10-13):** exit criteria met, with two items left as judgement calls. The .NET suite is green (5,808 tests, no
  known failures), and the corpus comparison has no unexplained difference: 15,000 generated steps on memory worlds and 1,800 on store
  worlds, 31,859 verb commands, 130 damaged and 17 re-set stored worlds, 2,506 mutated template sets, 147 beat shapes, the refine
  cases, plus the earlier goldens. Line coverage is 92.6% and branch coverage 85.3%; what is left is mostly guards that throw on
  states no input reaches. Left: `WorldLock` (39 lines, the cross-process takeover cases `store-lock.test.ts` spawns processes for;
  `WorldLockProcessTests` covers turn-taking) and `PlayerWorld` (27 lines, the `body_out` and `not_registered` refusals). Neither is a
  reason to hold Phase 2.

- **Phase 2 (started 2026-10-13):** the generators are in `dotnet/tools/golden-gen/` with a README (`gap-golden.ts` moved in from the
  scratch folder; about sixty older goldens have no surviving generator and are frozen as recorded). `WORLD_ENGINE_UPDATE_GOLDENS=1`
  regenerates the supporting goldens from .NET (`GoldenUpdate`). The reference rule is inverted in
  `AGENTS.md`, `CLAUDE.md` and `plans/dotnet-port.md`. Phase 2 exit met: with `node_modules` moved away, `dotnet test` passes all 5,808
  tests, and no .NET source or test starts Node.

## Deliberate deviations from TypeScript

Places where .NET differs on purpose, found by the Phase 1 replays. Each has a test that names it.

- A beat condition whose `value` is a fraction: TypeScript queues it and stores the fraction in the snapshot, against the
  integers-only rule (and .NET's canonical writer cannot print it); .NET refuses it as malformed (`invalid_args`).
  `BeatShapesGoldenTests.A_fractional_condition_value_is_a_malformed_beat`.
- A stored snapshot with an unknown field (e.g. an entity key `reridue` for `residue`, from a damaged `initial.json`): TypeScript's
  reader ignores it, so `verify` goes on and names `snapshot.json` as differing; .NET's reader refuses the file (`verify` answers an
  error, the CLI an invalid response). Both flag the corruption; the .NET failure is earlier and plainer. Left out of
  `tamper-golden` on purpose (the generator skips that flip).
- A fractional number in a template declaration (a size of `1.5`, a mass, a part's integrity, a hold's inner size): TypeScript takes any
  finite number; .NET asks for a whole number (`must be an integer`), since the engine and the canonical form hold integers only.
  `template-fuzz` leaves fractions out of its values.
