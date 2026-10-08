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
npm run bench                                   # 10k store commands; ms/cmd for the first and last 1k
npm run bench:scale                             # 500 entities, 20 rooms: ms/cmd and a pipeline/validate/rest split
npm run bench:reads                             # cost of since/observe/query/trace as the log grows to 10k
```

There's no lint step and no build output (`noEmit`; everything runs through `tsx`). Imports use `.js`
suffixes (NodeNext).

## Layout and flow

- `src/model.ts`: core types (`Snapshot`, `Entity`, `WorldEvent`, `Delta`, `Status`) and
  `defaultCoverage()`. `src/contract.ts`: Zod schemas for the CLI's JSON boundary (requests,
  responses, the snapshot). Zod is used only there and in `src/cli/`.
- `src/engine/pipeline.ts` `apply(snapshot, registry, command)`: the single transition entry point.
  It looks up the verb, then checks the actor, resolves the target (`resolve.ts`: name, alias or
  `entity.part`, among what the actor can address: `addressable` in `query.ts`, `docs/perception.md`) and runs `verb.preconditions`. Only after all of those pass does it emit the root
  event and call `verb.transition`. Any status other than `ok` returns the input snapshot unchanged.
   After the transition, `advanceClock` (`src/engine/clock.ts`; a verb's `wake_on` names agents whose senses end the time early, as `advance`'s `stop_on_perceived` and a `wait` with `until: "sensed"` do, `sensedBy` in `query.ts`) moves `tick` on by the verb's
   declared `duration` (one tick, `wait` and the author's `advance` their `ticks` arg, `edit` none), expiring every modifier due
   on the way with a `capability_changed` caused by the modifier's `cause_id`, under which the
   `modifiers` delta is recorded too (`docs/provenance.md`); `emit` stamps each event with the
   current `tick`, so an expiry carries the tick it fell due. At each tick it also runs the
   snapshot's `schedule` (`src/engine/schedule.ts`, `docs/schedule.md`): pending causes, absent when
   none: the `close` that `open` schedules on an openable with `closes_after` (`close` withdraws
   it; either way a shutting gate moves its footprint's occupants aside first, `pushOccupantsAside`
   in `verbs/gate.ts`, uncovering what each hid), and the `bleed` a severed part opens on a body with `bleed_*`
   props, each scheduling the next, a body bled out dropping what it held (`docs/bleeding.md`); the
   pipeline prunes causes whose entity is gone, a template's `processes` (`src/engine/process.ts`,
   `docs/processes.md`) are the third kind (the author's `schedule_beat` is a fourth, `src/engine/beats.ts`, `docs/beats.md`), reconciled against the props of every entity a command
   or a cause touched (`reconcileSince`; `createWorld` calls `startProcesses`; a bound can `then` set a
   prop, `hurt` the body or `removeEntity`), and `isAgent` is false for a destroyed body, and
   `perceive` answers `false` / `observer_destroyed` for one. Stored worlds are `schema_version` 5.
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
- Capacity needs are declared on the verb, never hard-coded, and every check reads its own verb's
  declaration through `context.verb`. `carry_alternatives` (`src/engine/carry.ts`: `manipulation`
  scaled by the item's `hands_required`, or `mouth_carry` within the carrier's `carry_limit_g` —
  one item at a time, never two-handed) gate `take` and `give` and drive attack's drop-on-loss rule;
  `carryCheck` refuses with the failure that came furthest through its conditions:
  `insufficient_<capacity>`, `two_hands_required`, `too_heavy`, `mouth_full`. `attack_modes` in
  `verbs/attack.ts` pick the strike (a fist reads `attack_damage`, a bite `bite_damage`).
  `requires` gates `lock`, `unlock`, and `put` into a container on `manipulation`; `open`,
  `close`, `drop`, and `put` onto a surface stay free. An attack that structurally removes the
  capacity a victim held with drops what it held — structural sums, not modifier dips: a stunned
  carrier holds on.
- `src/resolvers/physical.ts`: consequences that run after the verb, such as support loss,
  displacement, falls, breaking into `break_products`, residue transfer, `resolveImpact`
  (mass × distance against each party's mass × `break_fall_cm`), and `restingPlace` (the surface
  under a fall that catches it). Verbs call into it.
- `src/engine/query.ts`: `fact` and `perceive` queries (a `fact` subject may be `<entity>.<part>`; `reachable` answers
  by `inReach` in `verbs/address.ts`, the one reach rule `take`, `give`, `push`, `attack` and the
  rest apply). They answer `"true"`, `"false"` or
  `"unknown"` with a `basis_code`, from the snapshot, the templates, coverage and the replayed event
  list. Senses are `sight`, `hearing`, `smell`, and `touch`, read from `EVENT_SENSES` (one row per event type,
  `docs/senses.md`); sight needs a lit room (`isLit`: its `lit` prop, or a burning `light_source` in it that is not shut in a container; the `light` and `douse` verbs set `burning`); smell answers only where coverage declares it, else `"unknown"`. `touch` reads the
  observer's own body and grips instead of any room. `eventPerceivers` is the
  batch form: every agent, every covered sense, an agent listed exactly when `perceive` is true for
  it before or after the events' command.
- `src/engine/capacity.ts` (`capacity` adds part contributions and unexpired modifiers;
  `structuralCapacity`/`structuralCapacities` skip modifiers), `geometry.ts` (derived position and
  elevation along support/containment chains; `sweep`, how far a footprint slides before it meets
  another on the same support, which stops `push`/`pull` with `collided` or refuses `blocked`;
  `walkStop`, where an agent's `move` is refused: `out_of_bounds` past the room's footprint, whose
  origin is its centre, `blocked` by a `barrier` on the straight path or by anything solid at least
  `STEP_OVER_CM` tall at the destination; `gapStop`, the barrier a thing given, put or taken
  across a room cannot pass, its smallest dimension over the barrier's `gap_cm`, which `take`, `give`
  and `put` refuse `too_big_for_gap`, as does an `attack` whose mode crosses as the `body`, a bite),
  `spawn.ts` (ids from `next_seq`), `residue.ts`,
  `canonical.ts`, `carry.ts`, `validate.ts` (snapshot invariants: no loops, `pos`/`location` match
  the chain, no dangling references (`detached_from` is history, not a link), detached parts
  accounted for, no part stored at its default, integrity range, ids below `next_seq`), `parts.ts`
  (part state is sparse: an absent entry is the template default, intact at `max_integrity`; read
  through `partState`, write through `withParts`, which drops an entry set back to the default; a
  severed subtree is stored as its root alone, and `effectivePart` gives a part under a detached or
  destroyed ancestor that ancestor's status).
- `src/store/file-store.ts`: each world is a directory with `initial.json`, `snapshot.json`,
  `log.jsonl`, `events.jsonl`, `deltas.jsonl` and `head.json`. `submit` appends the log line (every command, including
  refused and invalid ones, as an `Attempt` with the version it was decided at and its reason), the command's events and an accepted command's deltas, atomically writes the snapshot, and writes
  `head.json` last: the three files' byte sizes, `log_entries` (all lines, used for default edit ids) and
  `ok_entries`. `resolveSubmission` runs `validateSnapshot` on every accepted result and
  downgrades a breaking one to `invalid` with the rule's code, so a verb bug is logged but never
  written; no verb leans on it, which the property test holds (an `apply` that is ok must stay ok). `load` trusts the snapshot when the head matches the file sizes and `ok_entries`, without
  reading the log; otherwise it counts `ok` entries, replays and rewrites the events, deltas and head if they
  disagree (a missing or short `deltas.jsonl`, or a head with no size for it, is rebuilt, which is why a world made before it still opens at `schema_version` 5). Writers take turns (`src/store/lock.ts`, `docs/locking.md`): a `lock` file made with the exclusive flag, held by `submit`, by `edit` around its default id, by `upgradeTemplates` and by the repair in `load`, whose fast path takes none and which settles a world under the turn after looking again; a waiter past `WORLD_LOCK_TIMEOUT_MS` fails `store_busy`, and a lock of a dead process or over a minute old is taken over. Store queries read `events.jsonl`, and `trace` of a field `deltas.jsonl`, each parsed once per handle and extended by the lines appended since; `since` and event-time perceive replay only from the newest usable
checkpoint (`checkpoints/`, a cache every 256 accepted commands, bound to the log bytes, `initial.json` and template set;
`docs/persistence.md`). A stale `based_on_version` is re-evaluated against the current snapshot, and a command that
  fails now but would have succeeded at its base version becomes `preempted`. `WorldError` codes
  surface as CLI issue codes. `verify` (`World.verify()`, or `verifyWorld(dir)` for a world not open, which
  the CLI's `verify` op uses since opening settles the files) replays the log from `initial.json` and
  names the first byte of `log.jsonl`, `events.jsonl`, `deltas.jsonl` or `snapshot.json` that differs
  (`docs/persistence.md`).
- `src/api.ts`: the public surface (`createWorld`, `openWorld`, `memoryWorld` → a `World` with
  `command`/`edit`/`check`/`options`/`since`/`attempts`/`query`/`observe`/`inspect`/`snapshot`/`entity`;
  `options` (`src/options.ts`) dry-runs every non-author verb against everything the actor can name
  (`addressable`) and sorts the verdicts into `ready`, `needs_args` and, on request, `blocked`; a verb's `suggest` lists the arg sets
  to try (`give`, `put`, `move`, `pour`), `free_args` the args no list holds, `aims_at_parts` (`attack`) has it
  tried at each part of a body in view (`docs/verbs.md`);
  `attempts(version)` is every submission decided at that version or later, ok or not, as an
  `Attempt` (`engine/command.ts`): a store world's log lines, a memory world's own record; `observe` is
  `src/engine/projection.ts` over the world's own `snapshot`, `since` and event-form `query`,
  `inspect` one entity of it in detail, and `command(c, { observe: true })` attaches the actor's
  projection since the version the command was applied to), re-exported by `src/index.ts` (with `actorWorld`,
  `src/actor-world.ts`: one actor's side of a `World`, results without the world's record) and by
  the package's `exports`, together with `verbs` (`verbCatalog` in `verbs/index.ts`, which throws on
  a verb that does not declare `args` and `refuses`, and returns structuredClone copies so callers
  cannot mutate the declarations the checks read). Command checks read their own verb's declaration
  through `context.verb`; a refusal with an undeclared code throws in `pipeline.ts`, which makes the
  whole suite a drift check for the declared lists. `src/errors.ts` holds `WorldError`, whose
  codes surface as CLI issue codes. The world's dice are `Snapshot.rng` (`src/engine/rng.ts`,
  `docs/rng.md`): `TransitionContext.random()` advances it, a world with no seed refuses a command
  that rolls `no_seed` (caught in `pipeline.ts`, a code no verb declares), `createWorld` and
  `memoryWorld` take `seed`, and a template process's `chance_pct` is the first roll. `edit` sends one `spawn`/`remove`/`place`/`set_props`/`set_part`/`set_seed`/`schedule_beat`/`cancel_beat`
  through the pipeline as the reserved non-agent author `world` (`WORLD_AUTHOR`, which also alone may issue `advance`: time with no agent waiting; a verb opts in with `author_only`), which skips the
  agency check; `src/engine/verbs/edit.ts` holds it. `check` runs `resolveSubmission` against the
  current version with the same validation gate, but never writes or logs; `since` folds the store's
  log, or a memory world's per-command records, into the deltas and events of every ok command after
  the version — a memory world only knows its own lifetime and throws `history_unavailable` below
  the version it started from. An event-form `perceive` is perceptible if true before or after
  that event's command; the store's `replayUntilEvent` in `store/file-store.ts` returns both
  snapshots, a memory world provides them through its history map, and `queryAtEvent` in the
  engine combines both answers, while the entity form and an unknown event read the present. A
  command with `perceivers: true` names, on every event of an ok result, who sensed it by sense
  (`Perceivers` in `model.ts`, validated by `PerceiversSchema`); the flag rides on the `Command`
  through the log and replay, and events without it carry no such field. `EditOptions` can set
  `perceivers: true` to enable this for edits, and the CLI's `edit` op accepts `perceivers` as a
  field. A default edit id is `edit-<n>` with n one plus the world's submission count — log lines
  for a store world, a closure counter over its own commands and edits for a memory one — so the
  same sequence of calls writes the same log through any number of handles. A memory world keeps
  past snapshots so stale commands preempt exactly like store-backed ones.
- `src/cli/main.ts`: a JSON adapter over `World` — it reads one request (`op`: `command` | `edit` |
  `check` | `options` | `since` | `attempts` | `query` | `observe` | `inspect` | `snapshot` | `verbs` |
  `capabilities` | `verify`, and the five `actor_*` ops of `docs/actor-view.md`, through `actorWorld`), calls one
  `World` method, `verbCatalog` or returns `ENGINE_CAPABILITIES` (`src/engine/capabilities.ts`: the
  relations and senses the engine computes, which `validateSnapshot` holds coverage to), and
  validates every response against `ResponseSchema` before writing it. `init <dir> <scenario.json>`
  builds a world from spawn specs in `scenarios/*.json`. A failure becomes `{status:"invalid",
  issues}` with exit code 2.

## Templates

`templates/*.json` are loaded and validated by `src/templates.ts`, and all of them are hashed into
`templates_hash`. Editing any template therefore makes existing worlds fail with `templates_changed`.
A detachable part needs a companion template named `<template>.<part>.json` (for example
`human.hand_l.json`). The registry is rejected when loading, in a world's templates.json, or by
`upgradeTemplates` if a detached part has no companion. Detaching spawns that template.
A human's `head` contributes `speech`, which `say` requires (`docs/speech.md`; the verb's `rootEvent` puts its event on the speaker even when addressed). `dog`, `cat`, and `horse` are agents with `moving`, `sight`, `hearing`, `smell` and a detachable
`jaw` that provides `mouth_carry`; default coverage stays `sight`+`hearing`, so smell answers only
where a snapshot's coverage declares it.

## Lane areas

One bullet per area, and an area is extended by appending to its own bullet only. A new verb or
refusal code also touches the shared registration points, one line or one entry each:
`src/engine/verbs/index.ts`, `src/errors.ts`, `src/contract.ts`, the verb table in
`tests/property-gen.ts`, and one line in the `docs/verbs.md` index, whose rules go in the family
file it links (`docs/verbs-*.md`; `tests/catalog.test.ts` holds the two in step).

- **Relations and perception:** `src/engine/validate.ts`, `src/model.ts` (`Entity`), the perception
  half of `src/engine/query.ts`, `docs/state.md`, `docs/perception.md`, `docs/relations.md`
  (one row per relation: kind, exclusivity, loop, live or history, what removal and detaching do,
  the enforcing `validateSnapshot` code and the test). `concealed_by` is that area's relation:
  `revealConcealed` in `verbs/search.ts` clears it when either end moves, and is called from `take`,
  `push`, `move` (for the walker and all it carries), the fall path in `physical.ts` and `edit`'s place and remove; sight of a concealed entity
  answers `false` / `concealed`, and a `found` event is perceived against its `concealer`, so it
  reads as where the search happened. Nothing records who searched or who knows. `touch` reads the
  observer's own body and grips (`own_body`, else `not_touching`) instead of any room, with its
  column in `docs/senses.md`; `take` from another agent's pocket is allowed, from a grip refused.
- **Templates:** `src/templates.ts`, `src/engine/upgrade.ts`, `templates/*.json`, the hash and
  companion rules above, and `docs/templates.md`: a template may declare `"extends": "<parent id>"`,
  resolved once when a set is loaded or parsed (own field wins, `props` shallow-merged, `parts`
  replaced only if declared, everything else inherited; a cycle or unknown parent is refused with
  the chain), so no `extends` key survives into the hash, a frozen `templates.json`, the companion
  rule or `lostField`. `templates/wine_bottle.json` is the worked example.
- **Materials:** `src/engine/residue.ts` and `src/resolvers/physical.ts`, whose behaviour the rest
  of the engine relies on; a material's own verb lives in `src/engine/verbs/` — `pour` moves
  `liquid_material`/`liquid_amount` between props and residue, and `docs/liquids.md` has that model.
- **Authoring space:** `src/scenario.ts`, the `place` path of `src/engine/verbs/edit.ts`, the `fact`
  half of `src/engine/query.ts`, `docs/api.md`. A position may be written as `{anchor, dx, dy}`
  instead of `pos` (`AnchorPos` in `command.ts`, `ScenarioOverrides` in `scenario.ts`): it resolves
  to the anchor's position in the anchor's room and adds no relation, refusing
  `conflicting_placement` beside a named holder and `anchor_not_room_supported` for an anchor not
  standing in a room. `templates/anchor.json` is the empty point template and declares
  `abstract: true`; an abstract entity is skipped by target resolution and answers `false` /
  `abstract` to perception (`isAbstract` in `resolve.ts`), which is why an anchor is a fixed point
  nothing can move. `fact`'s `near` is derived from both sides' positions under
  `NEAR_THRESHOLD_CM` (in the default coverage); docs: `docs/space.md`.

## Tests

`tests/*.test.ts` use `node:test` and `node:assert`. Engine tests deep-freeze the input snapshot and
compare with `canonicalJson`. Store tests write under `os.tmpdir()`. The `scenario-*` tests and
`acceptance` test run complete command sequences end to end.
