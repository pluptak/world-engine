# Intercoms

An intercom is the hearing counterpart of a camera ([camera.md](camera.md)): a device in a room that
carries the room's sound to the agent its feed reaches, and that agent's `say` into the room.
`templates/intercom.json` declares `intercom: true` (definition). `tests/intercom.test.ts` is the
spec.

**The feed.** An intercom feeds the agent at the end of its `controlled_by` walk, under the same
rule as a camera: not `destroyed`, and the walk carries a command (`feeds` in `src/engine/power.ts`,
kind `intercom`).

**Listening.** For `hearing`, when the observer's own answer is false, each intercom feeding it is
tried for an event in its own room, as if the observer stood at the intercom: under the event's
hearing row, `always` or a `volume` heard within `NEAR_THRESHOLD_CM` of the intercom. The answer is
`true` / `intercom`. A hand act (`quiet`) is not carried.

**Speaking.** A `say` by an agent that controls an intercom is heard by a listener standing in that
intercom's room, the same volume rule measured from the intercom. Only `say` is carried; a human's
speech is not, even beside the controller.

**Refusals.** Nothing crosses a door, and smell, sight and touch are never carried. An intercom
whose feed is cut (destroyed, or unpowered on its walk) carries nothing; an agent it does not feed
hears nothing through it. `intercom` is a `from` in a projection, so a subject who heard only
through it is told `intercom`, not `here` ([projection.md](projection.md)).

Not in it: delay, recording, a human using an intercom, broadcast beyond the rooms that hold one,
and volume set by the device.
