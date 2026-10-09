# AGENTS.md

Guidance for coding agents in this directory.

## What this repo is

- A deterministic, persistent, causal world-transition engine (physics is one resolver underneath
  persistent state). `CLAUDE.md` maps the code, `docs/DESIGN.md` indexes what is built, and
  `backlog.md` holds what comes next and in what order (its Priorities section), with longer plans in
  `plans/`. `plans/candidates.md` holds gaps with no plan yet: not work, never picked up by an agent.
- Nothing here imports Story-writer and Story-writer imports nothing from it. Keep the two
  independent. `..\Story-writer\CLAUDE.md` is the precedent for process and comment style.
- The hard rules and core types are the invariants below and `src/model.ts`; don't re-derive or
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

1. `npm run check:changed` passes: typecheck and the tests the change can reach. Run the full
   `npm run check` when it selects nearly everything anyway, or when the map is old.
2. Deliberately break one new test to confirm it can fail, then restore it.
3. Read the staged diff: only this block's changes.

## Stack and commands (`world-engine`)

- TypeScript `strict` + `noUncheckedIndexedAccess`, `module`/`moduleResolution` NodeNext, target ES2022,
  Node ≥ 20. Test runner is `node:test` via `tsx`. **Zod only at the JSON boundary.**
- `npm run check` = `typecheck` (`tsc --noEmit`) + every test, writing `.test-map.json`;
  `npm run check:changed` runs only the tests the change can reach (`CLAUDE.md`). No lint step.
- `npm test` = `node --import tsx --test "tests/**/*.test.ts"` — the script already globs everything, so
  a focused run needs a direct `node --import tsx --test tests/<file>.test.ts` instead of appending a
  path to `npm test`.
- devDependencies only: typescript, tsx, @types/node, zod. `data/` and `node_modules` are
  gitignored; store tests use `os.tmpdir()`.

## Invariants every block must preserve

- **Determinism.** No `Date`, no `Math.random`, never iterate unordered input without sorting. IDs come
  from `snapshot.next_seq` (`"e1"`, events `"ev1"`). Integer arithmetic only (cm, grams, integrity
  0..100). Same snapshot + same command ⇒ byte-identical output; compare with `canonicalJson`.
- **Pure core.** `engine/` functions take a `Snapshot`, return a new one, never mutate the input (tests
  deep-freeze it), and never do I/O. I/O lives **only** in `store/` and `cli/`.
- **`canonicalJson` is the only snapshot serializer** in the project — sorted keys at every depth, no
  whitespace. Reach for it instead of `JSON.stringify` on state.
- **No prose crosses the boundary.** Outputs are statuses, deltas, events, and machine codes
  (`reason_code`, `basis_code`) — never sentences.
- **The engine owns world state, never knowledge.** Do not model who knows/noticed/remembers anything.
- **`"unknown"` means the asked category is absent from `snapshot.coverage`** — never a stand-in for
  "I couldn't compute it". Existence *is* modelled: an unknown entity id answers `"false"` /
  `no_such_entity`.
- **Parts exist only where a template declares them.** Below the smallest declared part nothing is an
  entity: fragments become residue (material → amount) on whatever received them.
- **Actions check capacities, never parts.** `capacity()` returns `null`, not `0`, when the template
  declares no parts, so callers can tell "stone" from "paralysed human".
- **Templates are data** in `templates/*.json`, hashed into `snapshot.templates_hash`; a hash mismatch
  on load throws — no silent migration.
- **Comments only where a line is non-obvious** (a bound, an ordering, an asymmetry). No doc comments
  restating the code. History and lessons belong in git history.

## Doc size caps

- `world-engine/README.md` ≤ 15 lines. `docs/` describes **what is built, nothing aspirational**, one
  concept per file, each ≤ 40 lines and ≤ 100 columns; `docs/DESIGN.md` is the index of those files.
  A topic that outgrows its cap splits into a new file rather than losing content.

## Out of scope

The list is in `backlog.md` (Out of scope); do not build anything on it, even if the code would be
easier.
