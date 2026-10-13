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

(filled in as the questions are answered)
