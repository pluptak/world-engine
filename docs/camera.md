# Cameras

A camera is a thing in a room whose sight is the sight of the agent its feed reaches: the lab's
terminal watching the corridor from the server room. It is placed like anything else (no mounting,
no height), seen, taken if it fits, and destroyed like anything else; `templates/camera.json`
declares `camera: true` (definition). `tests/camera.test.ts` is the spec.

**The feed.** A camera feeds the agent at the end of its `controlled_by` walk, over the same two
links a door has ([power.md](power.md)), while the camera is not `destroyed` and the walk carries
a command: every link to the agent intact and powered. `feeds` in `src/engine/power.ts` lists the
cameras feeding an observer, in id order.

**Sight.** `perceive` answers from the observer's own body first. Only when that sight is false at
the location step does each feeding camera stand in for it, its own room only and lit: the first
that sees answers `true` / `camera`. What no body could see a camera does not either: `concealed`,
`enclosed`, `abstract`, `authored` and `unseen` come first, and so do the observer's own
`observer_destroyed` and `no_sense_capacity`, since a feed is watched with its own eyes. Hearing,
smell and touch never cross a camera, and it sees nothing across a door.

**What follows.** Everything that reads `perceive` reads the camera too: `observe` and the actor
view list what it shows; an act in its room names the fed agent among `perceivers.sight`; the agent
can name what it sees, and its own reach still refuses acting on it; an event is read against the
camera as it was before or after the event's command.

Not modelled: sound, a cone or a facing, a camera that moves or turns, delay and recording, a human
watching a feed, and anything telling a subject it is watched beyond seeing the camera.
