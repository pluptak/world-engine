# Surgery

`cut` opens a part of a body without severing it. The body is the target and the
part is `args.part`, which must name a part of the body's template; a part address
is no target (`target_attached`), and an unknown part is `invalid_args`.

One tick, and the actor needs `manipulation` 50. It must hold a thing whose template
has the `cuts` prop (a scalpel); else the cut is refused `no_cutting_tool`. The part
must read intact or damaged; else `part_unavailable`. An incised part refuses a
second cut with `already_incised`.

The transition marks the part `incised` under the root `cut` event, with no damage
to its integrity, and starts a bleed that names the part ([bleeding.md](bleeding.md)).
A body whose props declare no bleeding is incised and does not bleed. A cut is
audible.

`set_part` with `incised` in its `state` starts a scene with a wound already open.
