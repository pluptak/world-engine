# Reads that change nothing

- `check` agrees with `command` on the verdict without writing or logging.
- `options(actor, { refused? })` is what an actor can try now (`src/options.ts`):
  `ready`, the commands (`{ verb, target?, args? }`) a dry run accepts as they stand,
  each of which changes something (bar a `wait` and a `search`, whose answer may be
  nothing; the verbs refuse `already_open`, `already_locked`, `already_held`,
  `already_destroyed` and the like instead); `needs_args`, the verbs it cannot judge
  without args no list holds (`move` to a position, `pour` a part, `say`, `wait`); and
  with `refused`, `blocked`, the rest with their `reason_code`. It tries every verb but
  the author's against each thing the actor could name (`addressable`,
  [perception.md](perception.md): nothing hidden or out of sight and reach, an anchor
  never) and, for a verb that takes no target, once without one. A verb that needs args
  and `suggest`s some ([verbs.md](verbs.md)) is tried once with each, and its entries carry
  the `args` that made them: `give` to each agent, `put` on each surface and in each container
  and pocket, `move` through each door it can address (and down from what it stands on),
  `pour` the whole of a liquid onto each vessel, surface or room; ids the actor could already
  address, never one it could not. A verb that `aims_at_parts` (`attack`) is also tried at
  `<id>.<part>` for each part still on a body it sees or feels ([projection.md](projection.md)).
  Sorted by verb, then target. A destroyed body or a thing that is no agent has none; an
  unknown actor is `no_such_entity`. A read: nothing is logged. The CLI's `options` op takes
  `actor` and `refused`.
- `since` gives the deltas and events of every ok command after a version; `attempts` lists
  every submission decided at a version or later, refused, invalid, unresolved and preempted
  ones included, with the command, its base, the version it was decided at, its status, reason
  code and data, and candidates; a dry run is not one. The CLI's `attempts` op answers it.
