# Occupancy: footprints, what stops a push, and where a fall lands

An entity on a support occupies a footprint: its template's `size_cm.w` along x and `size_cm.d`
along y, centred on its position, axis-aligned. Two footprints overlap when `2·|Δx| < w₁ + w₂` and
`2·|Δy| < d₁ + d₂`, compared on doubled coordinates so odd sizes stay integral. Touching edges do
not overlap. Height plays no part: a stone does not pass under a table.

Overlap is a legal state, not a `validateSnapshot` rule: scenarios may place a dog under a table,
and an agent's `move` goes to its destination unchecked. Only motion collides, and today the only
motion that sweeps is `push` and `pull` (`sweep` in `src/engine/geometry.ts`).

A pushed entity meets only what stands on the same support, uncontained, not destroyed and not
abstract: a cup on a bench is no obstacle to a chair on the floor, and an anchor is a point that
nothing hits. Agents are obstacles like anything else. A footprint already overlapping the mover
never blocks it, so whatever starts entangled can always be moved apart.

The mover travels the largest whole distance, up to the one asked for, that leaves no overlap with
any obstacle ahead; the nearest one stops it, the lowest id on a tie. `moved` carries the distance
actually travelled, and when something stopped it short a `collided` event follows, caused by
`moved`, whose entity is the mover and whose `data.with` is the obstacle. The obstacle does not
move. A push that could not move at all is refused `blocked` with `reason_data.with`, and a push of
0 cm is never blocked. `collided` is heard and seen like any other event, and felt by the body of
what moved and of what it hit.

The impact is the mover's `mass_g` times the distance it travelled. Each party with a
`break_fall_cm` breaks when the impact is at least its own `mass_g` times that threshold, the
struck one first: the break runs exactly as a fall's does, caused by `collided`, with products and
residue where the broken thing stands. What declares no threshold takes no harm, agents included.

A fall comes to rest on the tallest surface (`surface: true`, what `put` sets things on) standing
on the room below it, lower than the height it falls from, whose footprint holds the landing point
strictly inside and is at least as wide and deep as the faller; else on the floor. The point is
the holder's centre for a drop and the lost support's for a support loss, which is never itself a
candidate. `fall_cm` is measured to that surface, and what lands on it has no `pos` of its own.
