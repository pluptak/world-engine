# Power and remote control

A device may be run from elsewhere: a door the lab's AI locks from the server room. Two props,
each naming one entity, link it (`src/engine/power.ts`); `scenarios/lab.json` is the worked
example and `tests/remote.test.ts` the spec.

- `power_source` (definition): an intact one supplies power; `templates/generator.json`.
- `powered_by` (state): the next link toward a source, a cable or the source itself.
- `controlled_by` (state): the next link toward the agent that controls this entity, a panel or
  the agent. Both may be written by the architect, and a scenario resolves them as ids.

**Powered.** Walk `powered_by` from the entity: every entity on the walk, the first included, is not
`destroyed`, and the walk ends at a `power_source`. An entity with neither is unpowered. Destroying
a link cuts it (`templates/cable.json` takes one human blow); nothing switches a source off.

**Controlled.** The controller is the agent at the end of the `controlled_by` walk. It names the
device from anywhere, by name or id, and its options offer it, whatever state the links are in;
it does not perceive it. `open`, `close`, `lock` and `unlock` from the controller skip reach, the
key and hands, and after `already_*` and `locked` walk from the device toward the controller, the
device included and the controller not: the first link `destroyed` is refused `disconnected`, the
first without power `unpowered`, each with `{ at }` that link; an `unpowered` also names `cut`: the
first destroyed entity on that link's `powered_by` walk, else the walk's last entity, which is no
source (the link itself when it has no `powered_by`). Everything else, the scheduled
close and moving occupants aside included, is unchanged.

**Manual.** Any other actor acts on the device as before, with no power needed: a key turns the
lock of a door whose cable is cut.

**Rules** ([relations.md](relations.md) R8): a link naming no entity is `dangling_reference`, so a
link cannot be removed; a walk that loops is `power_loop` or `control_loop`. A camera is a device
too: it feeds its controller while its walk carries a command ([camera.md](camera.md)).

**An agent's own power** (`agentFault`, checked before any verb). One with a `controlled_by` is held
to that walk and then to its controller's own fault ([manipulator.md](manipulator.md)); any other
with a `powered_by` acts only while powered, else every command is refused `unpowered`
`{ at: itself, cut }` and every sense is `false` / `unpowered`. Nothing is stored: power back, it
acts and senses again. An agent with neither, a human, is untouched (`tests/agent-power.test.ts`).

Not modelled: power for lights or humans, batteries or a slow failure, delays and partial failure,
and who may use a controller beyond the walk. A subject at a panel is in [panel.md](panel.md).
