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
- **Conditions.** `asleep` is built (`docs/senses.md`). Each other condition takes what it names, as
  `asleep` takes sight and hearing. Decided by the maintainer:
  - **Blind** takes sight; **deaf** takes hearing.
  - **Bound** is a hierarchy. Bound with no limb named takes movement and manipulation. Bound on a
    named part takes only what that part provides: bound legs take movement only. Open: which parts
    provide which capacity (a template question), and whether a bound body can still speak.
  - **Gagged** blocks speech down to sound: a gagged body's speech is heard as a sound, and no message
    gets through. Open: whether a gagged body's `say` is refused or becomes a sound event with no words.
  - **Unconscious** is not decided. Open: which senses and capacities it takes, whether an author sets
    it or a hit or bleed does, and how it ends.
  - Open for all: which scene needs which. Each is an item when a scene does.
- **A room going dark.** Decided by the maintainer: when a room goes dark, every sighted participant
  in it is blind until the light is back on. Open: this overlaps with the unlit rule, which already
  answers sight `false` / `location_unlit` in a dark room (`docs/senses-bases.md`). Whether the new
  rule is only the `darkened` event that tells the room the light went out, or a condition set on each
  participant. Open also: whether a scene row needs it.
- **`wait` outside a run.** A running run already refuses `wait` (`round_only`, `src/engine/run.ts`).
  Open: in worlds with no run, keep `wait` (the suite uses it throughout) or remove it.
- **A successor's held items.** The successor's field names are settled (`docs/templates.md`). Open:
  whether what a destroyed body held passes to its successor, or falls as it does now.
- **`WORLD_AUTHOR`.** It keeps every permission at once, for tests and repair (`docs/roles.md`). Open:
  when, if ever, the roles replace it.
