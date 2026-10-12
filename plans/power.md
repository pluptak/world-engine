# Power

Switching power on and off. A plan, not built; what is built is in
[../docs/power.md](../docs/power.md). Today power is derived, never stored: a device is powered when
every link of its `powered_by` walk is not destroyed and the walk ends at a `power_source`. So power
fails only by destruction, and nothing switches a source off; the lab's run cuts its generator's
`on` prop at a tick, and the server room goes dark with its lamp (`scenarios/lab-run.json`).

## The idea

One state prop on any link says whether it carries power. A generator that fails, a breaker thrown
and a terminal switched off are the same fact on different links, and the walk that finds where
power stops already exists. Light that runs on power goes out with it, so one cause (the generator
off) reaches the doors, the cameras, the terminal and the room's light together.

## Decided

- **`on`** (state, boolean): an entity that is a `power_source` or has a `powered_by` carries power
  only while `on` is not `false`. Absent means on, so no stored world and no template changes. The
  walk in `powered()` (`src/engine/power.ts`) fails at the first link that is destroyed or off, the
  source included; `unpowered`'s `cut` names that link. A breaker is a cheap link entity whose only
  job is its `on`.
- **One prop for supply and device:** a terminal switched off and a terminal with no power are both
  `unpowered`, each naming where power stops. No second prop for a device's own switch.
- **Verbs `switch_on` and `switch_off`:** on an entity that is a source or a link, else refused
  `not_switchable`; `already_on` / `already_off`. They need reach and `manipulation`, as `open`
  does, and take one tick. Each emits `switched { on }` on the entity, sensed by sight (and hearing
  where loud, as `open`'s event is). A link's controller (`controlled_by`) works it remotely as it
  works a door, through the same walk and refusals.
- **Beats need nothing new:** a power cut is `update_props { on: false }` on the generator, a
  restore `{ on: true }`; flicker is a beat and its follower.
- **Electric light:** a `light_source` with a `powered_by` lights its room while powered, read by
  `isLit` beside a burning flame; `burning` stays the flame's own prop. A room's own `lit` stays
  what the architect writes (daylight, a lit hall), untouched by power.
- **No event for losing power:** power is derived, so nothing is emitted when a device loses it;
  only the `switched` that caused it. An agent learns by what its senses stop giving, as with a cut
  cable today.

## Not in it

Batteries and stored charge, slow failure, partial power, load and capacity, who may use a switch
beyond reach and the control walk, and a sound or event for a room going dark.

## Open

- **A room going dark:** with no event, an agent in a room whose light fails sees less from the
  next look, but nothing says the light went out. If a lab row needs it, a derived `darkened` event
  on the room (emitted when `isLit` turns false within a command) is the candidate.

## Items, in order

1. `on` on links and the walk (`power.ts`, `fields.ts`, `docs/power.md`), with the beat test.
2. `switch_on` / `switch_off`, local and remote (`src/engine/verbs/`, the registration points).
3. Electric light in `isLit` (`query.ts`, `docs/perception.md`).
