# Other verbs

Striking, searching, waiting, and the author's edit.

- `attack`: picks the first mode its attacker can use (fist, bite), with damage from the template; a
  severed part opens a wound that bleeds ([bleeding.md](bleeding.md)); a lost part drops what it
  held, and a stunned victim keeps the rest.
- `search`: looks under or behind a target, with `manipulation` and in reach; one `found` per
  hidden thing names its concealer, nothing changes, and nothing records who looked.
- `wait`: takes `args.ticks` ticks and changes nothing else ([time.md](time.md)).
- `edit`: carries one `spawn`, `remove`, `place`, `set_props` or `set_part` as `args.edit`, and
  refuses with the code of the first snapshot rule its result breaks ([relations.md](relations.md)).
  A `place` may write `pos` as `{anchor, dx, dy}` ([space.md](space.md)) and `concealed_by`, which
  hides the placed thing under or behind another in the same room.
