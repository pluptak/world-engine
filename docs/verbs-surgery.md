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

**Staunches and sutures.** `staunch` takes the body and `args.part` and removes every
bleed of that part from the schedule, recorded under the root `staunch` event; with
none it is refused `not_bleeding`, and a bleed that names no part is never staunched.
`suture` clears `incised` on the part, refused `not_incised` when it is not incised;
it does not stop a bleed. Both need `manipulation` 50 and no tool, and both are
audible.
