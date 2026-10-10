# Roles

Who may do what to a world, and when. A plan, not built: `backlog.md` items come from it one at a
time. Today there are two roles, the world author (`WORLD_AUTHOR`: every `edit` and `advance`, at
any time) and the agents (commands, `actorWorld`).

## The four roles

- **Architect.** Builds the scene while it is stopped: `spawn`, `remove`, `place`, `set_props` of
  state-tier props only (`src/engine/fields.ts`), `schedule_beat`, the seed. Nothing else: no
  definition props, no parts, no templates. Once the scene stops again it comes back, either to
  continue the same world from where it stopped or to take its state as the blueprint of a new
  world (a new log whose initial state is that snapshot).
- **Director.** Steers the running scene through time only. Every beat is queued by the architect
  before the scene starts, a knock included; the director brings one forward, puts it back or
  cancels it, and runs the clock (`advance`, stopping before a beat). It never makes a beat, never
  retimes what the engine scheduled (a door's shut, a bleed, a process), never edits the world.
  It reads everything.
- **Character.** A player, an AI agent or a human, bound to a body in the world, acting through
  commands and sensing through `actorWorld`. Free to do anything the engine allows and nothing
  else. One player, one character; the lab's AI driving the terminal and the arm is the one
  exception so far (open below).
- **Observer.** A player with no body and no voice: reads, never writes, and nothing it does
  reaches the world. Not an entity, so it is never a perceiver, never woken, never in `options`,
  never named by anyone. It sees through a lens set when its view is made: following a
  character (that character's view plus chosen insight, such as what is concealed), one room
  whatever its light, or the whole world.

## The scene

A snapshot is `stopped` or `running` (a new field; a world with none is stopped). The architect
edits only while stopped; characters' commands and the director only while running, refused
`scene_stopped` / `scene_running` otherwise. `start` and `stop` are their own edits.

## Enforcement

The engine authenticates no one, so each role is a view the host hands out, as `actorWorld` is
(`architectWorld`, `directorWorld`, `observerWorld`), exposing only that role's operations. Under
the views, each edit kind declares the roles that may issue it, as a verb declares `author_only`,
a wrong one is refused `role_forbidden`, and the role rides on the command into the log, so
`attempts` shows who did what and the CLI cannot be used to step past a view.

## Open

1. Who starts and stops the scene: the host, the director, or the director stops and the architect
   starts?
2. The director's probability: odds within a range the architect declares (the exit door's
   `jam_pct` between 10 and 40), or none at all, since a retimed beat is already its whole power.
3. Blueprint: does the new world's clock start at 0, and are pending beats carried over?
4. One player driving several bodies (the lab's AI): a character bound to a list of bodies, or the
   lab's terminal and arm stay two characters one player holds.
5. The observer's insight: which lenses, and whether any of them sees the schedule.
6. What becomes of `WORLD_AUTHOR`: the architect's role under a new name, with the director's
   edits split off, or kept as a host role above all four for tests and repair.
