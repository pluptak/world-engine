# Finding, lighting, speaking

- `search`: looks under or behind a target.
  - Needs `manipulation`, in reach.
  - One `found` per hidden thing names its concealer.
  - Nothing changes. Nothing records who looked.
- `light`: sets `burning` on a `light_source` target.
  - Needs `manipulation`, in reach. Emits `lit`. Takes one tick.
  - Refuses `already_burning`, and `no_fuel` at `fuel` 0 or less.
  - Also `not_a_light`, `target_attached`, `container_closed`,
    `out_of_reach`.
  - Lit rooms are read from what burns ([perception.md](perception.md)).
  - Burning is a template process ([processes-shipped.md](processes-shipped.md)):
    `lantern` burns 1 fuel a tick and snuffs at 0; `candle`
    burns less and is used up at 0.
- `douse`: the same the other way, under `doused`.
  - Refuses `not_burning` and the same four others.
- `say`: says an opaque token at a volume.
  - `utterance` is 1-64 of letters, digits, `_.:-`. Never read.
  - `volume` is `whisper`, `normal` (default), or `shout`.
  - An optional target is the addressee.
  - Needs `speech` 50 from the speaker's parts. Takes one tick.
  - A bad token or volume is `invalid_args`.
  - Too little speech is `insufficient_speech`.
  - A destroyed body is no agent.
  - It changes nothing. The `say` event is the whole act
    ([speech.md](speech.md)).
