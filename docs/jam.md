# A remote command that can jam

A device with a positive `jam_pct` prop (a definition, on an openable: `templates/jamming_door.json`
sets 25) may fail the remote command its controller sends it ([power.md](power.md)).

**The roll.** A command from the device's controller, once its preconditions pass, rolls the world's
dice once ([rng.md](rng.md)); a roll under `jam_pct` jams it. A jam is `ok`, spends the tick, and emits
one `jammed` event on the device with `{ verb }`. The device does not change: no prop, no shut
scheduled, no occupant moved. A hand on the device, a target with no `jam_pct`, and a `jam_pct` of 0
never roll.

**Who knows.** `jammed` is sensed as `closed` is ([senses.md](senses.md)): a controller with a camera
on the device sees it, and one without learns only that its command was `ok`.

**No seed.** A world with no seed refuses a jamming device's remote command `no_seed`, as any roll.

The lab's exit door jams a quarter of the time, and `scenarios/lab.json` is seeded so its steps
replay; the lab's step K finds the seed's first jam (`tests/scenario-lab.test.ts`).

Not in it: wear, a jam that persists, jams for cameras or the arm, telling the controller why, and repair.
