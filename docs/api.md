# The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)`, `openWorld(dir)`, and
`memoryWorld(snapshot)` return a `World` with `command`, `edit`, `check`, `options`, `since`,
`attempts`, `trace`, `beat`, `upgradeTemplates`, `verify`, `query`, `observe` and `inspect`
([projection.md](projection.md)), `snapshot`, `entity`, `id` and `fork`. `verbs()` is the verb catalog and
`ENGINE_CAPABILITIES` what the engine computes; the CLI answers both (`op` `verbs`, `capabilities`).

**The CLI describes itself.** `{ "op": "schema" }` needs no world and answers `{ json_schema: "2020-12", request,
responses, failure }`: `z.toJSONSchema` of `RequestSchema` (one `oneOf` branch per op, each with its `op` as a
`const`), of the schema each op answers with, keyed by op, and of `{ status: "invalid", issues }`, which any op
gives to a request it refuses. A caller in another language, or one generating tool definitions, reads that
instead of `src/contract.ts`. `RESPONSES` in `src/contract.ts` is the table behind it (the compiler holds it to
one entry per op), and `ResponseSchema`, which the CLI checks every answer against, is the union of its values
and the failure. `tests/contract.test.ts` parses a real answer to every op with its own entry.
Store worlds share a directory, so handles see each other; memory worlds hold their own. A missing
directory, a changed hash, or a bad version is a `WorldError` with a code.

- `check` agrees with `command` on the verdict without writing or logging.
- `options(actor, { refused? })` is what an actor can try now (`src/options.ts`): `ready`, the commands
  (`{ verb, target?, args? }`) a dry run accepts as they stand, each of which changes something (bar a `wait` and a `search`, whose answer may be nothing; the verbs refuse `already_open`, `already_locked`, `already_held`, `already_destroyed` and the like instead); `needs_args`, the verbs it cannot judge
  without args no list holds (`move` to a position, `pour` a part, `say`, `wait`); and with `refused`,
  `blocked`, the rest with their `reason_code`. It tries every verb but the author's against each thing
  the actor could name (`addressable`, [perception.md](perception.md): nothing hidden or out of sight and
  reach, an anchor never) and, for a verb that takes no target, once without one. A verb that needs args
  and `suggest`s some ([verbs.md](verbs.md)) is tried once with each, and its entries carry the `args`
  that made them: `give` to each agent, `put` on each surface and in each container and pocket, `move`
  through each door it can address (and down from what it stands on), `pour` the whole of a liquid onto
  each vessel, surface or room; ids the actor could already address, never one it could not. A verb that
  `aims_at_parts` (`attack`) is also tried at `<id>.<part>` for each part still on a body it sees or feels
  ([projection.md](projection.md)). Sorted by verb, then target. A destroyed body or a thing that is no agent has none; an unknown actor is `no_such_entity`. A read:
  nothing is logged. The CLI's `options` op takes `actor` and `refused`.
- `since` gives the deltas and events of every ok command after a version; `attempts` lists every
  submission decided at a version or later, refused, invalid, unresolved and preempted ones
  included, with the command, its base, the version it was decided at, its status, reason code and
  data, and candidates; a dry run is not one. The CLI's `attempts` op answers it.
- `verify()` replays a store world's log from `initial.json`, deciding every line again as `submit` did, and
  compares what that makes with `log.jsonl`, `events.jsonl`, `deltas.jsonl` and `snapshot.json`, byte for
  byte ([persistence.md](persistence.md)): `{ ok: true, entries, version }`, or `{ ok: false, divergence: {
  file, line, code } }` for the first difference. It writes nothing. `verifyWorld(dir)` does the same for a
  world that is not open, which is how a damaged one is checked, since `openWorld` settles the files first
  and the CLI's `verify` op (`world`) goes that way. A memory world keeps no log and throws
  `history_unavailable`.
- `beat` runs commands in array order against one shared base, one log line each, each with its
  status, so a command an earlier one made fail is `preempted`.
- `trace` follows `cause_id` root-first from an event, or from the last delta of an entity field,
  else its spawn; an initial entity's field has an empty chain, and a memory world answers
  `history_unavailable` for what predates it.
- `perceivers: true` on a command or edit names who sensed each of its events.
- `createWorld` starts the processes its templates declare (`startProcesses`, also exported, for a
  caller that builds a snapshot itself and opens it with `memoryWorld`; [processes.md](processes.md)).
- `createWorld` and `memoryWorld` take an optional `coverage`, which the world's initial snapshot
  declares in place of `defaultCoverage()`; a category it leaves out answers `unknown`. They also take
  an optional `seed` for the world's dice, and without one anything that rolls is refused `no_seed`
  ([rng.md](rng.md)).

Refusals carry a machine `reason_code` and optional `reason_data` (reach, fit, enclosure, capacity
numbers), never prose. Edits (`spawn`, `remove`, `place`, `set_props`, `update_props`, `set_part`,
`set_seed`) are logged under the reserved non-agent author `world` and refused when they break an
invariant. A spawn, or a scenario entry, that writes a derived field (`location` other than its chain's,
or `modifiers`) is refused `derived_field` ([fields.md](fields.md)).

A scenario entry may declare `"id"`, and `location`, `support`, `contained_in`, `concealed_by`,
`detached_from.entity`, and the props `from`, `to`, and `opens` may name their entity. Names resolve
to `e<n>` in entry order before the first spawn; an empty, duplicate, id-shaped, or unknown name is
refused before anything is written. `World.id(name)` returns the id: `openWorld` reads the map back
from `ids.json`, `memoryWorld` takes it as an option.

`overrides.pos` may be `{anchor, dx, dy}` instead of `{x, y}`: it resolves to the anchor's position
plus the offset, in the anchor's room, before the first spawn. Naming a holder beside it is refused
`conflicting_placement`, an anchor that names nothing `unknown_anchor`, and one that is not standing
in a room `anchor_not_room_supported`; an `edit place` takes the same shape in `pos` by id and
refuses a bad anchor the same way, with `no_such_entity` for one that does not exist. See
[space.md](space.md).

`fork()` on either kind of world returns a memory world seeded from the current snapshot, with the
same templates, names, coverage and dice, whose own history starts at that version; it shares nothing
mutable with its parent, so a caller can run what-ifs or many rollouts without copying snapshots by
hand ([persistence.md](persistence.md)).
