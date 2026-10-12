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
    named part takes only what that part provides: bound legs take movement only.
    Recommended: take the capacity the part's template already declares, so binding removes that
    part's contribution the way damage does; no new mapping. A bound body can still speak; gagging
    stops speech, not binding.
  - **Gagged** blocks speech down to sound: no message gets through. A gagged `say` is not refused. The
    speaker is told by a `garbled` line on its own hearing, so it knows others will hear or understand it
    poorly. Recommended: a flag on the heard event, not scrambled words. The hearers already get only a
    sound, and scrambling would make the engine produce text, which the no-prose rule forbids.
  - **Unconscious** takes every sense and every capacity. Recommended: an author sets it, as `asleep`
    is set, and an edit ends it. A hit or bleed that causes it needs a threshold the engine does not
    have yet. Anaesthesia and other afflictions wait until a scene asks: each would be a second cause
    of the same state, so the author-set condition covers them then. The lab scenario does not ask.
  - Open for all: which scene needs which. Each is an item when a scene does.
- **A room going dark.** Decided by the maintainer: when a room goes dark, every sighted participant
  in it is blind until the light is back on. Recommended: no per-participant condition. The unlit rule
  already makes sight false in a dark room, which is that blindness, and a condition would duplicate it
  and need upkeep as the light changes. What is missing is the signal that the light went out: a
  `darkened` event on the room, emitted when `isLit` turns false within a command. Open: the basis code
  a sighted participant gets. Today it is `location_unlit`; say if a different one is wanted.
  Open also: whether a scene row needs the event at all.
- **`wait` outside a run.** A running run already refuses `wait` (`round_only`, `src/engine/run.ts`).
  Recommended: keep `wait` in worlds with no run. It is what the suite and single-agent worlds use, and
  removing it would rewrite many tests for no gain. Open: maintainer's decision.
- **A successor's held items.** The successor's field names are settled (`docs/templates.md`).
  Recommended: the held items fall where the body lay, as a spent thing's products already do. Passing
  them to the successor would move objects by a transfer nobody caused. Open: the maintainer's decision.
- **Surgery.** A scene where a patient is cut open and mended. Today the engine has no unconscious, so the
  patient feels and acts through it; the only cut is `attack`, which severs a part whole; and nothing
  stops a wound or joins a detached part back on. Needs: unconscious (author-set, see Conditions), a cut
  that opens a part without severing it, a treatment that stops a bleed, and reattachment. Open: whether
  a cut is a verb with its own capacity needs (a tool with `cutting`, or `manipulation`), whether
  treatment is a verb or a count (`bandage` is out of scope), and whether reattachment is a verb or an
  author's `edit`.
- **`WORLD_AUTHOR`.** It keeps every permission at once, for tests and repair (`docs/roles.md`).
  Recommended: keep it until every entry point checks the roles, since removing it now breaks tests and
  repair. Open: when, if ever, the roles replace it.
