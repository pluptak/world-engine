# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the process rules and the invariants (determinism, pure core, canonical JSON, no
prose, coverage/`"unknown"`, parts and capacities, templates as data). Read it first; this file only
adds what you need to find your way around the code. What to build next, in order, is the
Priorities section of `backlog.md`; `plans/candidates.md` is unplanned gaps, not work.

The engine is the .NET one: `src/` (the four projects), `tests/`, `tools/` and `WorldEngine.slnx` at the root. The
TypeScript engine it was ported from is gone from the tree and lives at the git tag `ts-final` (`plans/ts-sunset.md`).
`docs/` describes behaviour and is the specification, naming the .NET code and tests; its measurements and the limits files'
scripts are the TypeScript engine's, kept at the tag.

## Commands

```bash
dotnet test WorldEngine.slnx                       # the whole suite, large goldens sampled (about 40 s)
WORLD_ENGINE_DEEP=1 dotnet test WorldEngine.slnx   # every seed and row (about 2 min); once before a commit
dotnet test dotnet --filter "FullyQualifiedName~HostRunTests"   # one class or a name fragment
dotnet build WorldEngine.slnx                      # compile only
dotnet run --project src/WorldEngine.Cli -- init data/w1 scenarios/bottle.json     # create a world
echo '{"op":"snapshot","world":"data/w1"}' | dotnet run --project src/WorldEngine.Cli   # one JSON request on stdin
dotnet run -c Release --project tools/WorldEngine.Bench     # 10,000 store commands; ms/cmd first and last 1k
dotnet run --project tools/WorldEngine.Host -- <scene.json> <plan.json> <dir>   # the reference host (docs/host.md)
WORLD_ENGINE_UPDATE_GOLDENS=1 dotnet test dotnet          # rewrite the supporting goldens from .NET (read the diff)
```

There is no lint step. Tests are xUnit (`tests/WorldEngine.Tests`); store tests write under the
temp folder; `WorldEngine.LockChild` is the second process the lock tests spawn. The goldens are in
`tests/WorldEngine.Tests/Fixtures` and `tools/golden-gen/README.md` says where each
came from (TypeScript at its freeze, `83d5d4a`). A behaviour change updates its goldens in the same
commit, and the fixture diff is read like code.

## Layout and flow

Four projects in `src`, each referencing the ones above it: `WorldEngine.Core` (pure, no I/O),
`WorldEngine.Store` (files), `WorldEngine.Contract` (the JSON boundary), `WorldEngine.Cli`.

**Core** (`Model/`, `Json/`, `Templates/`, `Engine/`)

- `Model/`: `Snapshot`, `Entity`, `WorldEvent`, `Delta`, `Command`, `Status`, coverage, and `Value`
  (the engine's own value: bool, whole number, text, list, map; no null) that props, args and event
  data hold. `Json/` is the codec and the only code that knows JSON (`BoundaryTests`): `ValueJson`
  (text and nodes to `Value` and back), `WorldJson` (records, the options every file and request goes
  through, the cause `kind`) and `CanonicalJson` (the one writer: sorted keys, no whitespace).
- `Engine/Pipeline.cs` `Apply(snapshot, registry, verbs, command)` is the single transition entry. It
  looks up the verb, checks the actor, resolves the target (`Resolve.cs`: name, alias or
  `entity.part`, among what the actor can address) and runs the verb's preconditions. Only then does it
  emit the root event and call the transition. Any status other than `ok` returns the input snapshot
  unchanged. `ok` bumps `version`. After the transition `Scheduling/Clock.cs` moves `tick` by the verb's
  declared duration, expiring modifiers due on the way, and runs the pending causes of
  `Scheduling/Schedule.cs`: `close`, `bleed`, template `Processes`, scheduled `Beats`.
  `SnapshotValidation.cs` holds the snapshot invariants; a verb may define a `validateResult`.
  A refusal with a code the verb does not declare throws, which makes the whole suite a drift check.
- A transition changes state only through `Working` (`Engine/Working.cs`): `Set` records a delta and
  skips no-ops, `Emit` allocates the event id and chains `cause_id`, `Random()` advances the world's
  dice (`Rng.cs`; a world with no seed refuses a rolling command `no_seed`).
- `Engine/Verbs/*`: one file per verb family, registered in `VerbRegistry.cs` with the declared
  `args`/`refuses` in `VerbSpecs.cs`. Capacity needs are declared on the verb and read through the
  verb itself, never hard-coded. `EditVerb.cs` (with `EditParser`, `EditTransitions`, `EditRefusals`)
  is the author's verb: spawn, remove, place, props, parts, seed, beats, runs, roles, refine.
- `Engine/Physics/`: `Capacities` (parts plus unexpired modifiers; structural ones skip modifiers),
  `Geometry` (position/elevation along support and containment, `sweep`, `walkStop`, `gapStop`),
  `Carry`, `Fit`, `Harm`, `Power`, `Residue`, `PartStates` (sparse part state), `Placements`, and
  `Physical.cs`: the consequences that run after a verb (support loss, falls, breaking, `SpendEntity`,
  `RemoveEntity`, impact).
- `Engine/Perception/`: `Queries` (`fact` and `perceive`; answers `"true"`, `"false"`, `"unknown"` with
  a `basis_code`), `Perception`, `EventPerception`, `Reach` (the one reach rule), `Concealment`.
- `Engine/Scheduling/`: clock, schedule, processes (`ProcessSpec`), beats (`Beat*`), runs, rounds,
  pending moves. `Engine/Scenes/`: the scene builder, scenario forms, `Refine`, `Upgrade`.
- `Engine/Worlds/`: the facade shared by memory and stored worlds: `IWorld`, `IWorldDriver`,
  `IWorldReads`, `MemoryWorld`, `WorldReads` (check, options, observe, inspect), `Submission` (the
  stale-version and preempt rule, validation gate), `Projection`, `Trace`, `Options`, `Catalog`,
  `ActorWorld`, `PlayerWorld`, `DirectorWorld`.
- `Templates/`: `TemplateShape` (checks a declaration's JSON as the loader must), `TemplateResolver`
  (`extends`, `part_overrides`, lineage), `TemplateValidation`, `TemplateHash` (`templates_hash`).

**Store** (`src/WorldEngine.Store`): a world is a directory (`initial.json`, `snapshot.json`,
`log.jsonl`, `events.jsonl`, `deltas.jsonl`, `head.json`, `checkpoints/`, `lock`), `schema_version` 5.

- `WorldWriter.Submit` takes the turn (`WorldLock`), appends the log line (every command, refused
  and invalid too), the events and an accepted command's deltas, writes the snapshot every 32 accepted
  commands, then `head.json` last. `WorldSettle.Load` trusts the head when it matches the file sizes
  and folds the log forward from the snapshot's byte; otherwise it repairs under the turn. A snapshot
  that breaks an invariant is downgraded to `invalid` and never written.
- This process remembers the hash of a registry, the head it last wrote and the snapshot it last left
  (`WorldReplay.Remember`, `WorldFiles.RememberHead`), valid while the files' sizes and write times
  are as it left them: reads after a write need no fold.
- `WorldReplay` (full and partial folds), `WorldCheckpoints` (cache every 256 accepted commands),
  `WorldHistory` (since, trace, event-time perceive), `WorldVerify` (names the first byte of any file
  that differs from a replay), `WorldUpgrade` (a world moves to another template set), `WorldBuilder`
  (`init`/`restart`), `StoreWorld` (the stored `IWorld`), `StoredPending` (`pending.json`),
  `WorldIO` (reads that do not hold a file against a writer on Windows), `WorldLock` (exclusive file
  create, dead-process or minute-old takeover, `store_busy` after `WORLD_LOCK_TIMEOUT_MS`).

**Contract** (`src/WorldEngine.Contract`): `Checks`, the shape of each op's request and of a scenario
and a coverage file, built from the combinators in `Shape.cs`. **Cli** (`src/WorldEngine.Cli`):
`CliRunner.Run(args, input)` reads one request, checks its shape, dispatches to one world operation,
and answers `{status:"invalid", issues}` with exit code 2 on failure. `init <dir>
<scenario.json>` builds a world; the ops are listed in `docs/api.md`.

## Templates

`templates/*.json` at the repository root are loaded and validated by `TemplateDirectory` and
`TemplateResolver`, and all of them are hashed into `templates_hash`. A stored world keeps its own resolved
set in `templates.json` and opens with it, so editing a template reaches only worlds made afterwards; a
different set handed to a world is refused `templates_changed` (`WorldUpgrade.UpgradeTemplates` moves one).
Editing a template does move the goldens, which read `templates/`. A detachable part needs a
companion template named `<template>.<part>.json` (for example `human.hand_l.json`); a child that
declares no `parts` inherits its parent's. `extends` is resolved once when a set is loaded; a cycle
or unknown parent is refused with the chain. `docs/fields.md` is the schema of every prop the engine
reads; a template declares a prop no code reads under `fields`.

## Areas

One bullet per area; extend an area by appending to its own bullet only. A new verb or refusal code
also touches the shared registration points, one line each: `VerbRegistry.cs`, `VerbSpecs.cs`,
`Model/Code.cs`, the contract, and one line in the `docs/verbs.md` index, whose rules go in the
family file it links (`docs/verbs-*.md`).

- **Relations and perception:** `SnapshotValidation.cs`, `Model/Snapshot.cs` (`Entity`), `Perception/`,
  `docs/state.md`, `docs/perception.md`, `docs/relations.md`. `concealed_by` is that area's relation:
  `Concealment.RevealConcealed` clears it when either end moves.
- **Templates:** `Templates/`, `Scenes/Upgrade.cs`, `templates/*.json`, `docs/templates.md`, `docs/fields.md`.
- **Materials:** `Physics/Residue.cs`, `Physics/Physical.cs`, `PourVerb.cs`, `docs/liquids.md`.
- **Authoring space:** `Scenes/`, the `place` path of `EditVerb.cs`, the `fact` half of `Queries.cs`,
  `docs/api.md`, `docs/space.md`. A position may be written `{anchor, dx, dy}`; abstract entities
  (`templates/anchor.json`) are skipped by target resolution.

## Tests

xUnit. Goldens compare by meaning through `Meaning` (key order and null against absent do not count; a
failure names the path), and bytes are checked only where they are the contract: the canonical writer and
the store's own files against themselves. The goldens replay recorded TypeScript answers (verb matrix, property traces, damaged worlds, template fuzz, beat shapes,
refine) and the `acceptance` and `scenario-*` sequences (`Block21ReplayTests`). `PropertyTraceTests`
also runs the sequences on a store world. A test for a new behaviour sits beside the file it
covers; a deliberate deviation from TypeScript has a test that names it (`plans/ts-sunset.md`).
