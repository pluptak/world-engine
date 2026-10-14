# The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)` (a list of
entries, or a scene, [scenario.md](scenario.md)), `openWorld(dir, options?)`, `restartWorld(from, to)`
([restart.md](restart.md)), and `memoryWorld(snapshot)`
return a `World` with `command`, `edit`, `check`, `options`, `since`, `attempts`, `trace`,
`schedule` ([schedule-api.md](schedule-api.md)), `beat`, `round` ([rounds.md](rounds.md)),
`upgradeTemplates`, `verify`, `query`, `observe` and `inspect` ([projection.md](projection.md)),
`snapshot`, `entity`, `catalog` ([catalog.md](catalog.md)), `id` and `fork`. `verbs()` is the
verb catalog and `ENGINE_CAPABILITIES` what the engine computes; the CLI answers both
(`op` `verbs`, `capabilities`).

**The CLI checks a request before it runs it.** Each op has a shape (`Checks` in
`WorldEngine.Contract`): its members, their types, no member beyond them. A request that does not
fit is answered `{ status: "invalid", issues }` with `invalid_request` and exit code 2, and nothing
is run for it. A command's `args` hold whole numbers only, and no null in a list; a fraction there
does not fit. Otherwise the inside of an edit, `args` or a prop is read by the engine, which
refuses with its own codes. Store worlds share a directory, so handles see
each other; memory worlds hold their own. A missing directory, a changed hash, or a bad
version is a `WorldError` with a code.

- `beat` runs commands in array order against one shared base, one log line each, each with its
  status, so a command an earlier one made fail is `preempted`.
- `trace` follows `cause_id` root-first from an event, or from the last delta of an entity field,
  else its spawn; an initial entity's field has an empty chain, and a memory world answers
  `history_unavailable` for what predates it.
- `perceivers: true` on a command or edit names who sensed each of its events.
- `createWorld` and `memoryWorld` take an optional `coverage`, which the world's initial snapshot
  declares in place of `defaultCoverage()`; a category it leaves out answers `unknown`.
  They also take an optional `seed` for the world's dice, and without one anything that rolls
  is refused `no_seed` ([rng.md](rng.md)).
- `openWorld(dir, { snapshotEvery, checkpointEvery })` sets how often this handle writes `snapshot.json`
  (default 32) and a checkpoint (default 256): whole numbers from 1, else a `TypeError`. Nothing stores it.
- `restartWorld(from, to)` makes a world at `to` from `from`'s `initial.json` and frozen
  `templates.json` ([restart.md](restart.md)); `world_exists` when `to` holds one, `no_such_world`
  when `from` holds none.
