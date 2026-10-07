# The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)`, `openWorld(dir)`, and
`memoryWorld(snapshot)` return a `World` with `command`, `edit`, `check`, `options`, `since`,
`attempts`, `trace`, `beat`, `upgradeTemplates`, `query`, `observe` and `inspect`
([projection.md](projection.md)), `snapshot`, `entity`, `id` and `fork`. `verbs()` is the verb catalog and
`ENGINE_CAPABILITIES` what the engine computes; the CLI answers both (`op` `verbs`, `capabilities`).
Store worlds share a directory, so handles see each other; memory worlds hold their own. A missing
directory, a changed hash, or a bad version is a `WorldError` with a code.

- `check` agrees with `command` on the verdict without writing or logging.
- `options(actor, { refused? })` is what an actor can try now (`src/options.ts`): `ready`, the commands
  (`{ verb, target? }`) a dry run accepts as they stand; `needs_args`, the verbs it cannot judge
  without args (`give`, `put`, `move`, `say`, `wait`); and with `refused`, `blocked`, the rest with their
  `reason_code`. It tries every verb but the author's against each thing the actor could name
  (`addressable`, [perception.md](perception.md): nothing hidden or out of sight and reach, an anchor
  never) and, for a verb that takes no target, once without one. Sorted by verb, then target. A
  destroyed body or a thing that is no agent has none; an unknown actor is `no_such_entity`. A read:
  nothing is logged. The CLI's `options` op takes `actor` and `refused`.
- `since` gives the deltas and events of every ok command after a version; `attempts` lists every
  submission decided at a version or later, refused, invalid, unresolved and preempted ones
  included, with the command, its base, the version it was decided at, its status, reason code and
  data, and candidates; a dry run is not one. The CLI's `attempts` op answers it.
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
numbers), never prose. Edits (`spawn`, `remove`, `place`, `set_props`, `set_part`, `set_seed`) are logged under
the reserved non-agent author `world` and refused when they break an invariant.

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
