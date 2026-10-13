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
- Still open in Phase 1: the store-world side of the soak (`property-store-*`: a store world, its files and `verify`), the
  `scenarios/*.json` run through both engines, `verify` on the sample worlds, and the table of TS tests with no .NET counterpart.
