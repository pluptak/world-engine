# The author's edit

- `edit`: carries one change as `args.edit`. Takes no time.
  - `spawn`, `remove`, `place`, `set_props` (replaces),
    `update_props` (merges), `set_part`, `refine`
    ([refine.md](refine.md)), `set_seed` ([rng.md](rng.md)),
    `schedule_beat`, `cancel_beat`, `retime_beat`
    ([beats.md](beats.md)), `start_run`, `end_run`.
  - Refused with the code of the first snapshot rule its result
    breaks ([relations.md](relations.md)).
  - A `place` may write `pos` as `{anchor, dx, dy}`
    ([space.md](space.md)) and `concealed_by`, hiding the thing
    under or behind another in the same room.
  - A `place`, or a `spawn`'s overrides, empties a field by naming
    it in `clear` (`"clear": ["pos"]`); a field it leaves out is left
    alone. A request holds no null: a null field is an absent one.
