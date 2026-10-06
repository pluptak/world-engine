# Walking

An agent's `move` to a position is checked before anything changes, and a refused move moves
nothing (`walkStop` in `src/engine/geometry.ts`). In order:

- **The room.** A room's origin is its centre, and the agent's footprint must lie inside the room's
  (`size_cm`, 1000 × 1000 for `room`): past the wall is `out_of_bounds`.
- **The way there.** The straight path is checked only against barriers, things whose props say
  `barrier: true`: it is `blocked`, naming the first barrier the footprint would meet (the lowest id
  on a tie). Furniture and people on the way are assumed walked around. A barrier that is `open` (a
  gate standing open) is no barrier.
- **The destination.** The footprint may not overlap anything solid on the same support: `blocked`,
  naming the lowest id. Solid means what a push would meet, less what is under `STEP_OVER_CM`
  (20 cm) tall, which is stepped over or stood on: a note, a key, a cup, shards.

Overlap an agent already has never stops it, so whatever a scenario or an edit places inside
something can always walk out. A move to another room needs an open door, keeps its coordinates,
and is checked where it lands there, with no path; a door is not a barrier inside either room.

`templates/bars.json` is a 100 cm section of bars, `barrier: true` with `gap_cm: 12`, too heavy to
push or carry; `gate.json` extends it with `openable`, so `open`, `close`, `lock` and `unlock` work
on it with a key that `opens` it. Bars block walking and pushing but not sight, hearing or reach:
two agents on either side within reach see each other and `attack` through them.

**The gap.** A thing handed over (`give`), set down (`put`) or lifted (`take`) goes on a straight,
centimetre-wide line between the two positions, and every shut barrier on it must fit the thing
turned edgewise: its smallest dimension at most `gap_cm`, else `too_big_for_gap` naming the first
barrier, the size and the gap (`gapStop` in `geometry.ts`). A key, cup or book passes 12 cm bars; a
stone does not. A barrier without `gap_cm` passes nothing, and no gap ever lets an agent through. An
`attack` mode says how it crosses (`crosses_gap`): a fist is a `limb` and reaches through any gap, a
bite is the `body` and needs the attacker's own smallest dimension to fit, so a dog (25) cannot bite
through 12 cm bars. `pour` ignores the gap: liquid passes bars. `scenarios/cell.json` cuts a room in
two with ten sections, wall to wall; `tests/scenario-cell.test.ts` is its spec.

What it does not do: there is no pathfinding (a caller routes round a barrier in several moves), a
drop still falls from the holder's centre so a walking agent drops at its feet and sets things on a
table with `put`, and a push is stopped by what stands in the room, never by its walls.
