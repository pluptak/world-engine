# Golden generators

The .NET suite is held to the TypeScript engine by recorded answers ("goldens") in
`tests/WorldEngine.Tests/Fixtures`. TypeScript was the reference when they were recorded; its last change is `83d5d4a`
(2026-10-12). TypeScript is frozen (`plans/ts-sunset.md`), so from here a golden moves only when the .NET engine's behaviour is changed
on purpose, and the change to the fixture is part of the same commit and is read as a diff.

## Generators in this folder (they need Node and the TypeScript tree)

The TypeScript tree is removed from the main branch; it lives at the tag `ts-final`. To run a generator, check that tag out into a separate
worktree (`git worktree add ../world-engine-ts ts-final`, then `npm ci` there) and run `node --import tsx tools/golden-gen/<file>.ts`
from it, with this folder's generators copied in.

| Generator | Fixture(s) | .NET test |
|---|---|---|
| `property-trace.ts` | `property/` (steps and hashes of 500 seeds, the initial snapshot, the fixture templates) | `PropertyTraceTests` |
| `verb-matrix.ts` | `verb-matrix.expected.json.gz` | `VerbMatrixTests` |
| `tamper-golden.ts` (with `mixed-world.ts`) | `tamper-golden.expected.json`, `tamper-templates/` | `TamperGoldenTests` |
| `takeover-golden.ts` (with `mixed-world.ts`) | `takeover-golden.expected.json` | `TakeoverGoldenTests` |
| `template-fuzz.ts` | `template-fuzz.expected.json.gz` | `TemplateFuzzTests` |
| `beat-shapes-golden.ts` (with `scripted.ts`) | `beat-shapes-golden.expected.json` | `BeatShapesGoldenTests` |
| `refine-golden.ts` (with `scripted.ts`) | `refine-golden.expected.json`, `refine-templates/` | `RefineGoldenTests` |
| `gap-golden.ts` | `gap-golden.expected.json` | `GapGoldenTests` |

`scripted.ts` records a world driven through calls on TypeScript's memory world as rows the .NET `MemoryGoldenTests.Replay` reads.
`mixed-world.ts` is the stored-world run of `tests/verify.test.ts`, shared by the tamper and takeover goldens.

## Regenerating from .NET

```bash
WORLD_ENGINE_UPDATE_GOLDENS=1 dotnet test --filter "FullyQualifiedName~VerbMatrixTests"
git diff --stat tests/WorldEngine.Tests/Fixtures
```

With the variable set, a supporting test writes what .NET does into the fixture in the source tree and passes. Read the diff before
committing it: it is the list of everything the change did. The first update of a fixture TypeScript wrote also normalises its layout
(keys sorted); that is the one large diff.

Supported: `VerbMatrixTests`, `PropertyTraceTests` (the memory-world test), `TamperGoldenTests`, `TakeoverGoldenTests`,
`TemplateFuzzTests`, `Block21ReplayTests`, `VerbGoldenTests`, `EditTests`, the scripted rows (`MemoryGoldenTests`, `RefineGoldenTests`, `BeatShapesGoldenTests`) and
the `command` and `validate` rows of `GoldenRows`. Not supported: the fixtures with a test of their own shape (the `cli-*`, `init`,
`store-*`, `contract-*` and similar); when a change breaks one, edit the fixture by hand from the failure message.

Goldens compare by meaning (`tests/WorldEngine.Tests/Meaning.cs`): key order, and a null member against an absent one, do not
count, and a failure names the path where the two part. A stored world's files compare as values, line by line for `.jsonl`; what
`head.json` and a checkpoint say about other files' bytes is checked against the files instead. The hashes the verb matrix, the
property traces, the tamper and takeover goldens and `block21/golden.json` keep are of that meaning (`Meaning.Digest`,
`Meaning.FileDigest`), regenerated from .NET when they stopped being TypeScript's byte hashes.

`beat-shapes-golden.expected.json` lacks the three rows TypeScript recorded with a fraction in an edit (`repeat float`,
`follower float delay`, `edit: tick float`): the contract refuses such a request before the engine reads it, and
`ChecksTests` covers it.

## Fixtures with no generator

About sixty fixtures were recorded by scratch scripts that were not kept (the verb goldens `*-golden.expected.json`, the `*.snapshot.json`
states and `*-commands.json` lists they start from, `block21/`, `init/`, `cli-*`, `store-*`). They are frozen as recorded; the
differential goldens above cover the same ground more widely, and `plans/ts-sunset.md` records what each found.
