# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the process rules and the invariants (determinism, pure core, `canonicalJson`, no
prose, coverage/`"unknown"`, parts and capacities, templates as data). Read it first; this file only
adds what you need to find your way around the code. Its opening line ("Plan only — no code here")
was written for the plan directory; blocks 0–9 are implemented in this repo, and `plan.md` lives
outside it.

## Commands

```bash
npm run check                                   # the gate: tsc --noEmit + all tests
npm run typecheck
npm test                                        # globs tests/**/*.test.ts; don't append a path
node --import tsx --test tests/query.test.ts    # one file
node --import tsx --test --test-name-pattern="<regex>" tests/query.test.ts   # one test
npm run world -- init data/w1 scenarios/bottle.json                          # create a world
echo '{"op":"snapshot","world":"data/w1"}' | npm run world --silent          # one JSON request on stdin
```

There's no lint step and no build output (`noEmit`; everything runs through `tsx`). Imports use `.js`
suffixes (NodeNext).

## Layout and flow

- `src/model.ts`: core types (`Snapshot`, `Entity`, `WorldEvent`, `Delta`, `Status`) and
  `defaultCoverage()`. `src/contract.ts`: Zod schemas for the CLI's JSON boundary (requests,
  responses, the snapshot). Zod is used only there and in `src/cli/`.
- `src/engine/pipeline.ts` `apply(snapshot, registry, command)`: the single transition entry point.
  It looks up the verb, then checks the actor, resolves the target (`resolve.ts`: name, alias or
  `entity.part`) and runs `verb.preconditions`. Only after all of those pass does it emit the root
  event and call `verb.transition`. Any status other than `ok` returns the input snapshot unchanged.
   `ok` bumps `version`. A verb may also define `validateResult`, which runs after its transition:
   a failure returns the input snapshot unchanged. `edit` uses it to refuse results that break a
   snapshot invariant. `move` to another room, `place`, and removals re-derive `location` for the
   whole subtree below the change (`refreshSubtreeLocations` in `verbs/address.ts`); `place` setting
   one relation clears the other, `spawn` fills an omitted `location` from the chain, and what a
   removed support or container held takes the relation the removed thing itself was in — carried
   by its holder, inside its container, else on the surface under it.
- Verbs (`src/engine/verbs/*.ts`) implement `Verb` from `command.ts` and are registered in
  `verbs/index.ts`. A transition mutates state only through its `TransitionContext`: `set` (records a
  delta, skips no-ops), `emit` (allocates `ev<next_seq>` and chains `cause_id`), `recordDelta`, and
  a `snapshot` getter and setter that verbs use to splice in `spawn()` results.
- `src/resolvers/physical.ts`: consequences that run after the verb, such as support loss,
  displacement, falls, breaking into `break_products`, and residue transfer. Verbs call into it.
- `src/engine/query.ts`: `fact` and `perceive` queries. They answer `"true"`, `"false"` or
  `"unknown"` with a `basis_code`, from the snapshot, the templates, coverage and the replayed event
  list.
- `src/engine/capacity.ts`, `geometry.ts` (derived position and elevation along support/containment
  chains), `spawn.ts` (ids from `next_seq`), `residue.ts`, `canonical.ts`, `validate.ts` (snapshot
  invariants: no loops, `pos`/`location` match the chain, no dangling references (`detached_from` is
  history, not a link), detached parts accounted for, integrity range, ids below `next_seq`).
- `src/store/file-store.ts`: each world is a directory with `initial.json`, `snapshot.json` and
  `log.jsonl`. `submit` logs every command (including refused and invalid ones) before it atomically
  writes the snapshot. `resolveSubmission` runs `validateSnapshot` on every accepted result and
  downgrades a breaking one to `invalid` with the rule's code, so a verb bug is logged but never
  written. `load` replays the log if the snapshot version disagrees with the count of `ok`
  entries. A stale `based_on_version` is re-evaluated against the current snapshot, and a command that
  fails now but would have succeeded at its base version becomes `preempted`. `WorldError` codes
  surface as CLI issue codes.
- `src/api.ts`: the public surface (`createWorld`, `openWorld`, `memoryWorld` → a `World` with
  `command`/`edit`/`query`/`snapshot`/`entity`), re-exported by `src/index.ts` and by the package's
  `exports`. `src/errors.ts` holds `WorldError`, whose codes surface as CLI issue codes. `edit` sends
  one `spawn`/`remove`/`place`/`set_props`/`set_part` through the pipeline as the reserved non-agent
  author `world` (`WORLD_AUTHOR`), which skips the agency check; `src/engine/verbs/edit.ts` holds it.
  A default edit id is `edit-<n>` with n one plus the world's submission count — log lines for a
  store world, a closure counter over its own commands and edits for a memory one — so the same
  sequence of calls writes the same log through any number of handles.
  A memory world keeps past snapshots so stale commands preempt exactly like store-backed ones.
- `src/cli/main.ts`: a JSON adapter over `World` — it reads one request (`op`: `command` | `edit` |
  `query` | `snapshot`), calls one `World` method, and validates every response against `ResponseSchema` before
  writing it. `init <dir> <scenario.json>` builds a world from spawn specs in `scenarios/*.json`. A
  failure becomes `{status:"invalid", issues}` with exit code 2.

## Templates

`templates/*.json` are loaded and validated by `src/templates.ts`, and all of them are hashed into
`templates_hash`. Editing any template therefore makes existing worlds fail with `templates_changed`.
A detachable part needs a companion template named `<template>.<part>.json` (for example
`human.hand_l.json`). Detaching spawns that template, and `attack.ts` throws if it is missing.

## Tests

`tests/*.test.ts` use `node:test` and `node:assert`. Engine tests deep-freeze the input snapshot and
compare with `canonicalJson`. Store tests write under `os.tmpdir()`. The `scenario-*` tests and
`acceptance` test run complete command sequences end to end.
