# AGENTS.md

Guidance for coding agents in this directory.

## What this directory is

- **Plan only — no code here.** `plan.md` is the spec: blocks 0–9 of "world-engine", a deterministic,
  persistent, causal world-transition engine (physics is one resolver underneath persistent state).
- Implementation lives in a **separate repo**, `C:\Users\Peter\source\repos\LLM-playground\world-engine`
  (`git init`, no commit at block 0). Nothing imports Story-writer; Story-writer imports nothing from
  it. Keep the two repos independent.
- `plan.md` is the source of truth. The **Shared brief** (hard rules + core types) is pasted verbatim
  above every block prompt — read it from `plan.md`, don't re-derive or paraphrase the types.
- `..\Story-writer\CLAUDE.md` is the precedent this series copies for process and comment style.

## Working process — one block per session

- Deliver **one small, independently pausable block**, the smaller self-contained slice even when it is
  not the most efficient path. Finish and verify it before the next block is started.
- The block prompt names its files, exact types, tests and a done-condition. **Follow it literally.** If
  the spec is ambiguous or contradicts existing code, stop and report rather than guess.
- Hard prohibitions (from the shared brief): **no git commit**, **no dependencies beyond those the block
  names**, **do not start the next block**, no edits to files outside the block's scope.
- Report at the end: files changed, tests added, any deviation and why. The report is a claim, not
  evidence.

### Verification (the human runs these after each block — expect to be asked to have done them)

1. `npm run check` in `world-engine` passes.
2. Deliberately break one new test to confirm it can fail, then restore it.
3. Read the diff; `git log` confirms there is no agent commit.

## Stack and commands (`world-engine`)

- TypeScript `strict` + `noUncheckedIndexedAccess`, `module`/`moduleResolution` NodeNext, target ES2022,
  Node ≥ 20. Test runner is `node:test` via `tsx`. **Zod only at the JSON boundary, only from block 8.**
- `npm run check` = `typecheck` (`tsc --noEmit`) + `npm test`. That is the gate; there is no lint step.
- `npm test` = `node --import tsx --test "tests/**/*.test.ts"` — the script already globs everything, so
  a focused run needs a direct `node --import tsx --test tests/<file>.test.ts` instead of appending a
  path to `npm test`.
- devDependencies only: typescript, tsx, @types/node (+ zod in block 8). `data/` and `node_modules` are
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

## Doc size caps (explicit in `plan.md`)

- `world-engine/README.md` ≤ 15 lines; `docs/DESIGN.md` ≤ 80 lines and describes **what is built, nothing
  aspirational**.

## Out of scope — do not build these, even if the code would be easier

- the social resolver, continuous physics (Rapier/Box2D), free-text targets beyond
  name / alias / `entity.part`, any Story-writer integration.