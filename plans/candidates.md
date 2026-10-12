# Candidates

Known gaps with no plan yet. **Not work for a coding agent:** nothing here is ready, and each entry
ends in open questions that are the maintainer's to settle. A candidate is promoted by writing it
up as an item in `backlog.md` (its files, types, tests and done-condition) and adding it to the
Priorities there, then deleting it here in the same commit.

- **Who authors templates.** The catalogue is `templates/`: an architect picks presets and never
  writes one, and a world author changes state, never a definition. Open: who adds a preset a scene
  needs, and whether that is ever done while a world runs or only between worlds (`upgradeTemplates`).
- **Facing and a sight cone for bodies.** In a lit room every act is seen (`docs/limits.md`); the
  costliest of the limits, revisit when a concrete world needs what darkness, concealment and
  staging cannot give. A camera's cone is built (`docs/camera.md`); a body's would also need a facing that
  changes as it moves or turns, and `turn` is out of scope. Open: who sets a body's facing, and
  whether hearing or touch ever reads it.
- **Conditions beyond asleep.** Bound, unconscious, blind and deaf would each take its own senses
  and capacities, as `asleep` does (`docs/senses.md`). Each is an item when a scene needs it, and no
  scene does yet. Open: which scene needs which.
- **A room going dark.** With no event, an agent in a room whose light fails sees less at the next
  look, but nothing says the light went out. Candidate: a derived `darkened` event on the room, emitted
  when `isLit` turns false within a command. Open: whether a scene row needs it.
- **`wait` outside a run.** Kept for tests and single-agent worlds, or removed now that rounds exist
  (`docs/rounds.md`). Open: keep or remove.
- **A successor's held items.** The successor's field names are settled (`docs/templates.md`). Open:
  whether what a destroyed body held passes to its successor, or falls as it does now.
- **`WORLD_AUTHOR`.** It keeps every permission at once, for tests and repair (`docs/roles.md`). Open:
  when, if ever, the roles replace it.
