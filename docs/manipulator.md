# A manipulator

An arm is an agent with a gripper and no legs: it takes, puts and gives what is within its reach,
and nothing else (`templates/arm.json`). Someone else sends its commands: a controller is handed
`actorWorld(world, arm)`, as the lab's terminal is for its door.

**Body.** A `base` with no capacity and a `gripper`: `manipulation` 50, a grip, `max_integrity` 40,
so one human blow destroys it. `reach_cm` 150, `hand_height_cm` 100. No `moving`, `sight`,
`hearing` or `speech`: it cannot move, and it senses nothing, so its view lists nothing and it
addresses only what it can reach (`gropable`).

**Control.** An agent with a `controlled_by` acts only while its control walk carries the command
([power.md](power.md)). The pipeline checks this before the target is resolved, for every verb: a
broken link refuses the command `disconnected` or `unpowered` with `{ at }`, and `unpowered` also
`cut` (`src/engine/pipeline.ts`). An agent with no `controlled_by` is not checked; a human or the
terminal acts as before.

**Lab.** `scenarios/lab.json` puts the arm by the key in the lab, powered by the cable and
controlled by the terminal. `tests/scenario-lab.test.ts` has a second scenario: the arm takes the
key, ann's take from its grip is refused, bob cuts the cable, the arm's drop is `unpowered`, and
ann's blow on the gripper drops the key for her to take.

**Tests.** `tests/manipulator.test.ts` is the spec.

Not modelled: sight through a camera, durations or a command in progress, joints or a track, and
the terminal's own power.
