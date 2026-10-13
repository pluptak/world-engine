# AGENTS.md

Guidance for coding agents in this directory.

## Status: the engine is .NET

The engine is the .NET one under `dotnet/` (`plans/ts-sunset.md`). The TypeScript in `src/`, `tests/`, `scripts/` and `package.json` is frozen
and will be deleted: no feature work, no refactors, no fixes there. The goldens (`dotnet/tools/golden-gen/README.md`) are the reference
for behaviour recorded from TypeScript; a change to .NET behaviour updates its goldens in the same commit, as a diff that is read.

## What this repo is

- A deterministic, persistent, causal world-transition engine (physics is one resolver underneath
  persistent state). `CLAUDE.md` maps the code, `docs/DESIGN.md` indexes what is built, and
  `backlog.md` holds what comes next and in what order (its Priorities section), with longer plans in
  `plans/`. `plans/candidates.md` holds gaps with no plan yet: not work, never picked up by an agent.
- Nothing here imports Story-writer and Story-writer imports nothing from it. Keep the two
  independent. `..\Story-writer\CLAUDE.md` is the precedent for process and comment style.
- The hard rules and core types are the invariants below and `src/WorldEngine.Core/Model/`; don't re-derive or
  paraphrase the types.

## Working process — one block per session

- Deliver **one small, independently pausable block**: the top unblocked entry of `backlog.md`'s
  Priorities, or one block of the plan it points to. Finish and verify it before the next is started.
  With no unblocked entry, stop and report; never promote or build a candidate.
- The item or block names its files, exact types, tests and a done-condition. **Follow it literally.**
  If the spec is ambiguous or contradicts existing code, stop and report rather than guess.
- Hard prohibitions: **no dependencies beyond those the block names**, **do not start the next
  block**, no edits to files outside the block's scope.
- Done = the verification below passes. Then commit the block, with the backlog item (or plan block)
  deleted in the same commit, staging only your own files: other sessions may share the checkout.
- Report at the end: files changed, tests added, any deviation and why. The report is a claim, not
  evidence.

### Verification (before the commit)

1. `dotnet test dotnet/WorldEngine.slnx` passes (about 40 s). Use `--filter "FullyQualifiedName~<name>"` while working.
2. Deliberately break one new test to confirm it can fail, then restore it.
3. Read the staged diff: only this block's changes.

## Stack and commands (`world-engine`)

- .NET 10, C# with nullable enabled, four projects under `src` (Core, Store, Contract, Cli), xUnit tests in `dotnet/tests`, tools
  (benchmark, reference host, golden generators) in `dotnet/tools`. The JSON boundary uses typed records and a generated JSON Schema, not
  Zod. No NuGet package beyond the test stack unless a block names it.
- `dotnet test dotnet/WorldEngine.slnx` is the whole check; `CLAUDE.md` lists the other commands. No lint step.
- `data/` is gitignored; store tests use the temp folder. Source files are CRLF on this checkout: edit them with the Edit tool, or open
  them with `newline=''` from a script.

## Invariants every block must preserve

- **Determinism.** No wall clock and no `Random` in the engine, never iterate unordered input without sorting (`StringComparer.Ordinal`). IDs come
  from `snapshot.next_seq` (`"e1"`, events `"ev1"`). Integer arithmetic only (cm, grams, integrity
  0..100). Same snapshot + same command ⇒ byte-identical output; compare with `CanonicalJson`.
- **Pure core.** `Engine/` functions take a `Snapshot`, return a new one, never mutate the input,
  and never do I/O. I/O lives **only** in `WorldEngine.Store` and `WorldEngine.Cli`.
- **`CanonicalJson` is the only snapshot serializer** in the project — sorted keys at every depth, no
  whitespace. Reach for it (via `WorldJson`) instead of `System.Text.Json` directly on state.
- **No prose crosses the boundary.** Outputs are statuses, deltas, events, and machine codes
  (`reason_code`, `basis_code`) — never sentences.
- **The engine owns world state, never knowledge.** Do not model who knows/noticed/remembers anything.
- **`"unknown"` means the asked category is absent from `snapshot.coverage`** — never a stand-in for
  "I couldn't compute it". Existence *is* modelled: an unknown entity id answers `"false"` /
  `no_such_entity`.
- **Parts exist only where a template declares them.** Below the smallest declared part nothing is an
  entity: fragments become residue (material → amount) on whatever received them.
- **Actions check capacities, never parts.** `Capacities` returns `null`, not `0`, when the template
  declares no parts, so callers can tell "stone" from "paralysed human".
- **Templates are data** in `templates/*.json` (repository root), hashed into `snapshot.templates_hash`; a hash mismatch
  on load throws — no silent migration.
- **Comments only where a line is non-obvious** (a bound, an ordering, an asymmetry). No doc comments
  restating the code. History and lessons belong in git history.

## Doc size caps

- `world-engine/README.md` ≤ 15 lines. `docs/` describes **what is built, nothing aspirational**, one
  concept per file, each ≤ 40 lines and ≤ 100 columns; `docs/DESIGN.md` is the index of those files.
  A topic that outgrows its cap splits into a new file rather than losing content.
- Write for humans first: plain words, short sentences, lists over paragraphs. Where a shape,
  chain, or flow is easier drawn than described (support chain, cause chain, file layout), add a
  small ASCII schematic, no tooling needed.

## Out of scope

The list is in `backlog.md` (Out of scope); do not build anything on it, even if the code would be
easier.
