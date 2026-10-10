# Roles

Who may do what to a world, and when. A plan, not built: `backlog.md` items come from it one at a
time. Today there are two roles, the world author (`WORLD_AUTHOR`: every `edit` and `advance`, at
any time) and the agents (commands, `actorWorld`).

## Roles are permission sets

A role is not an entity and not a mind: it is a set of permissions a handle carries, and whoever
holds the handle (a human, an AI agent, a test, a middleware) is outside the engine. The engine
checks each operation against the set it arrives with and records the set in the log, so
`attempts` shows under which role each thing was done. One controller may hold several handles.

- **Architect.** Builds the scene while it is stopped: `spawn`, `remove`, `place`, `set_props` of
  state-tier props only (`src/engine/fields.ts`), `schedule_beat`, the seed, the scene's tick limit,
  and the odds the director may steer, each with its range. Nothing else: no definition props, no
  parts, no templates. When the scene is ready it says so (`ready`); any edit after that withdraws
  it. After a stop it comes back to continue the same world or to take its state as the blueprint
  of a new one (a new log whose initial state is that snapshot).
- **Director.** Starts a scene the architect made ready, and from then until it stops steers it:
  brings a queued beat forward, puts it back or cancels it, runs the clock (`advance`, stopping
  before a beat), steers the odds within the architect's ranges, and stops the scene. It never
  makes a beat, never retimes what the engine scheduled (a door's shut, a bleed, a process), never
  edits the world. It reads everything, but on a stopped scene it may do nothing but `start`.
  Further powers are for later.
- **Character.** Drives a body: commands, and senses through one view. Any agent the templates
  allow, not a human only: a dog, a terminal, a sword with a will. Free to do anything the engine
  allows and nothing else. A body may be several entities, apart from each other (the lab's AI is
  its terminal, its arm and its cameras): the permission names every entity it drives, and its view
  is one view with one alias for each thing, read through all of their senses.
- **Observer.** Reads and never writes, so nothing it does reaches the world; not an entity, so it
  is never a perceiver, never woken, never in `options`, never named. It sees through a lens set
  when the handle is made: following a character (its view plus chosen insight, such as what is
  concealed), one room whatever its light, or the whole world.
- **`WORLD_AUTHOR`** stays, every permission at once, for tests and repair, until the four replace
  it.

## The scene

A snapshot is `stopped` (a world with none), `ready` or `running`. The architect works on a stopped
scene and readies it; the director starts a ready one. A scene stops when the director says so or
when its tick limit, set by the architect, runs out, so no simulation runs forever. A stop resets
every timer: the schedule is emptied (beats, shuts, bleeds, processes) and modifiers expire, so the
next run starts from the architect's queue alone; processes start again from their props at the
next start. Characters' commands and the director's steering are refused on a scene that is not
running (`scene_not_running`), the architect's edits on one that is (`scene_running`).

## Open

1. A stop: does the clock keep counting (events never go back within one world) and only a
   blueprint start at 0, or does a continuation start at 0 as well?
2. The odds the director steers: which are steerable (`jam_pct`, a process's `chance_pct`) and how a
   steer is stored (a state prop beside the template's value, read in its place).
3. A body of several entities: whether the arm and the cameras stay separate agents the permission
   lists, or become parts of one body that stands in several places (parts share their entity's
   position today). The first is a permission change; the second an engine change.
4. A character that is a thing: whether an agent can be carried (a sword with a will) and still act.
5. The observer's lenses, and whether any sees the schedule.
6. The director's further powers.
