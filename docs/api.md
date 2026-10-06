# The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)`, `openWorld(dir)`, and
`memoryWorld(snapshot)` return a `World` with `command`, `edit`, `check`, `since`, `attempts`,
`trace`, `beat`, `upgradeTemplates`, `query`, `observe` and `inspect`
([projection.md](projection.md)), `snapshot`, `entity`, and `id`. `verbs()` is the verb catalog and
`ENGINE_CAPABILITIES` what the engine computes; the CLI answers both (`op` `verbs`, `capabilities`).
Store worlds share a directory, so handles see each other; memory worlds hold their own. A missing
directory, a changed hash, or a bad version is a `WorldError` with a code.

- `check` agrees with `command` on the verdict without writing or logging.
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
- `createWorld` and `memoryWorld` take an optional `coverage`, which the world's initial snapshot
  declares in place of `defaultCoverage()`; a category it leaves out answers `unknown`.

Refusals carry a machine `reason_code` and optional `reason_data` (reach, fit, enclosure, capacity
numbers), never prose. Edits (`spawn`, `remove`, `place`, `set_props`, `set_part`) are logged under
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
