# The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)` (a list of
entries, or a scene, [scenario.md](scenario.md)), `openWorld(dir)`, `restartWorld(from, to)`
([restart.md](restart.md)), and `memoryWorld(snapshot)`
return a `World` with `command`, `edit`, `check`, `options`, `since`, `attempts`, `trace`,
`schedule` ([schedule-api.md](schedule-api.md)), `beat`, `round` ([rounds.md](rounds.md)),
`upgradeTemplates`, `verify`, `query`, `observe` and `inspect` ([projection.md](projection.md)),
`snapshot`, `entity`, `catalog` ([catalog.md](catalog.md)), `id` and `fork`. `verbs()` is the
verb catalog and `ENGINE_CAPABILITIES` what the engine computes; the CLI answers both
(`op` `verbs`, `capabilities`).

**The CLI describes itself.** `{ "op": "schema" }` needs no world and answers
`{ json_schema: "2020-12", request, responses, failure }`: `z.toJSONSchema` of `RequestSchema`
(one `oneOf` branch per op, each with its `op` as a `const`), of the schema each op answers
with, keyed by op, and of `{ status: "invalid", issues }`, which any op gives to a request
it refuses. A caller in another language, or one generating tool definitions, reads that
instead of `src/contract.ts`. `RESPONSES` in `src/contract.ts` is the table behind it (the
compiler holds it to one entry per op), and `ResponseSchema`, which the CLI checks every
answer against, is the union of its values and the failure. `tests/contract.test.ts` parses
a real answer to every op with its own entry. Store worlds share a directory, so handles see
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
- `restartWorld(from, to)` makes a world at `to` from `from`'s `initial.json` and frozen
  `templates.json` ([restart.md](restart.md)); `world_exists` when `to` holds one, `no_such_world`
  when `from` holds none.
