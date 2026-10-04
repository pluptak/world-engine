# Liquid

Liquid is a prop, not an entity: a vessel declares `liquid_material` and `liquid_amount`, and
`liquid_amount` counts the cubic centimetres its `inner_*_cm` dimensions do. A vessel emptied by a
pour or by breaking declares an empty `liquid_material` and `liquid_amount` 0, which is what "holds
no liquid" means everywhere.

`pour <source>` with `args.destination` (an address, as `put` uses) and an optional integer
`args.amount`:

- The source must be carried by the actor and hold liquid; anything else is `not_carried`,
  `no_liquid` or `nothing_to_pour`.
- The destination must be within reach (`out_of_reach`; a room has no position of its own, so the
  actor's own room is the floor) and able to take liquid: a `container`, a `surface`, or the room
  itself. Anything else is `not_a_destination`, a part address included.
- A container destination takes the liquid into its own `liquid_material` and `liquid_amount`, on
  top of what it already holds; a surface or the floor takes it as residue through `addResidue`. A
  shut destination, or one inside a shut container, is `container_closed`.
- It needs `manipulation`, and pours only whole positive integers: an `args.amount` above what the
  source holds is `insufficient_liquid`, and anything else is `invalid_args`.
- A container's liquid capacity is its inner volume, and overflow is refused rather than capped or
  spilled: a pour that would exceed it is `container_full` with the numbers. A container already
  holding a different material is `incompatible_liquid`; the same material simply adds up.

A successful pour emits one `poured` event on the source with `{material, amount, to}`, then writes
the source's props (amount lowered, material cleared when empty) and either the destination's props
or its residue under that event.