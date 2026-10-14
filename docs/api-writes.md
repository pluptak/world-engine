# Writes and names

Refusals carry a machine `reason_code` and optional `reason_data` (reach, fit,
enclosure, capacity numbers), never prose. Edits (`spawn`, `remove`, `place`, `set_props`,
`update_props`, `set_part`, `refine`, `set_seed`) are logged under the reserved non-agent
author `world` and refused when they break an invariant. A spawn, or a scenario entry, that
writes a derived field (`location` other than its chain's, or `modifiers`) is refused
`derived_field` ([fields.md](fields.md)). A spawn's or scenario entry's `props` merge onto
the template's instead of replacing them, so an entry names only what it changes; a spawn
whose definitions differ from the template's is refused `field_not_editable`. `traits` (a map
of tokens, [state.md](state.md)) are written the same way and by nothing else. A scenario entry
alone may use the architect forms `fuel_pct`, `liquid`, `condition`, `hunger_pct` and
`portions_pct`, and writes nothing else but placement, names, traits and a few plain states
([forms.md](forms.md)).

A scenario entry may declare `"id"`, and `location`, `support`, `contained_in`, `concealed_by`,
`detached_from.entity`, and the props `from`, `to`, and `opens` may name their entity. Names resolve
to `e<n>` in entry order before the first spawn; an empty, duplicate, id-shaped, or unknown name is
refused before anything is written. `World.id(name)` returns the id: `openWorld` reads the map back
from `ids.json`, `memoryWorld` takes it as an option. A name is any non-empty string
that is not `e<n>`, `__proto__` and `constructor` included.

**A string from outside is looked up by the record's own keys.** An id, template or name
spelt like a member of `Object.prototype` (`__proto__`, `constructor`, `toString`,
`hasOwnProperty`, `valueOf`) is nothing the world has: it gets what an id like `e999999`
gets in the same place (`unresolved`, `no_such_entity`, `unknown_template`, `entity` and
`id` answering nothing), and the world is unchanged. `own` in `src/model.ts` is the read.

`overrides.pos` may be `{anchor, dx, dy}` instead of `{x, y}`: it resolves to the anchor's position
plus the offset, in the anchor's room, before the first spawn. Naming a holder beside it is refused
`conflicting_placement`, an anchor that names nothing `unknown_anchor`, and one that is not standing
in a room `anchor_not_room_supported`; an `edit place` takes the same shape in `pos` by id and
refuses a bad anchor the same way, with `no_such_entity` for one that does not exist. See
[space.md](space.md).
