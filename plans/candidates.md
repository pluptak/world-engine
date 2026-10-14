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
    named part takes only what that part provides: bound legs take movement only. A bound part takes
    the capacity its template already declares, so binding removes that part's contribution the way
    damage does; no new mapping. A bound body can still speak; gagging stops speech, not binding.
  - **Gagged** blocks speech down to sound: no message gets through. A gagged `say` is not refused. The
    speaker is told by a `garbled` line on its own hearing, so it knows others will hear or understand it
    poorly. The garble is a flag on the heard event, not scrambled words: hearers already get only a
    sound, and scrambling would make the engine produce text, which the no-prose rule forbids.
  - Open for all: which scene needs which. Each is an item when a scene does. Unconscious is built
    (`docs/senses.md`).
- **A room going dark.** Decided: when a room goes dark, every sighted participant in it is blind until
  the light is back on. No per-participant condition: the unlit rule already makes sight false in a dark
  room, which is that blindness, and a condition would duplicate it and need upkeep as the light changes.
  What is added is a `darkened` event on the room, emitted when `isLit` turns false within a command. A
  sighted participant keeps the basis `location_unlit`. Open: whether a scene row needs the event at all.
- **`wait` outside a run.** A running run already refuses `wait` (`round_only`, `src/engine/run.ts`).
  Decided: `wait` stays in worlds with no run, since the suite and single-agent worlds use it. Removing it
  would rewrite many tests for no gain.
- **A successor's held items.** The successor's field names are settled (`docs/templates.md`). Decided:
  the held items fall where the body lay, as a spent thing's products already do. Passing them to the
  successor would move objects by a transfer nobody caused.
- **`WORLD_AUTHOR`.** It keeps every permission at once, for tests and repair (`docs/roles.md`). Decided:
  it stays until every entry point checks the roles, since removing it now breaks tests and repair. Open:
  when, if ever, the roles replace it.
- **Surgery.** A scene where a patient is cut open and mended. Unconscious is built (`docs/senses.md`),
  so the patient no longer feels or acts through it; the only cut is `attack`, which severs a part
  whole; and nothing stops a wound or joins a detached part back on. Needs: a cut that opens a part
  without severing it, a treatment that stops a bleed, and reattachment, which is a socket (see
  Sockets). Minimal props:
  - part state `incised` (boolean, state): the part is cut open; only an incised part can have something
    installed in it or taken out, and while it is open its `bleed` runs.
  - The verbs `cut` (opens a part, needs `manipulation` and a held thing with `cutting`) and `close_wound`
    (clears `incised`, stops that part's bleed).
  Open: whether a cut is a verb with its own capacity needs (a tool with `cutting`, or `manipulation`),
  whether treatment is a verb or a count (`bandage` is out of scope), and whether reattachment is a verb or
  an author's `edit`.
- **Control of a body handed to another.** Scenes: a curse that bends a victim's will (Imperius), a
  hacked implant, two minds swapping bodies. Today `controlled_by` walks only physical links (a cable, a
  panel, `docs/power.md`), and an agent under it has no will of its own: the pipeline cannot tell the
  body's own command from its controller's, since both arrive through `actorWorld(body)`. Inside a run,
  a body cannot change slots (`docs/roles.md`, "Not in it"); a successor is the only hand-over, and only
  on destruction. Needs: a control link that is not a device, a command that says who sent it, and a body
  moving to another slot during a run. Minimal props and fields:
  - `controlled_by` (state, id), reused: may name an abstract link entity (a curse, `templates/anchor.json`
    style) whose own `controlled_by` names the controlling agent.
  - `lapses_at` (state, integer, a tick) on the link: the clock removes the link at that tick, as a
    modifier expires, with a `released` event caused by the one that made the link.
  - `overrides_will` (definition, boolean) on the link's template: while the walk holds, the body's own
    commands are refused `controlled` and only the controller's pass. Without it the link shares control
    (the body acts too), as a hacked implant might.
  - On the command, not a prop: `via` (the controlling agent's id), set by the controller's handle as `by`
    is set by a role (`docs/roles.md`), and checked against the end of the walk.
  - An edit kind `transfer_body { body, slot }` (director and author) for a mind swap within a run.
  Open: whether a controlled body perceives for the controller (does the curser see what the victim
  sees) or only acts; whether breaking free is a roll (`jam_pct`-style odds on the link, with a seed) or
  only `lapses_at` and destroying the link; and whether `transfer_body` replaces the "Not in it" line in
  `docs/roles.md` or is a separate rule for swaps only.
- **Sockets: a part filled by another entity.** Scenes: a cyber-arm in place of a severed arm, an implant
  in the head, a face sewn onto another body, a severed hand reattached. Today only declared parts exist
  and a part's `contributes` is fixed by its template; `refine` can swap the whole body's template, but
  then the arm is never a thing anyone holds, and every set of augments is a template of its own. Needs:
  a part whose contributions come from the entity installed in it, and verbs to install and remove one.
  Minimal props and fields:
  - `socket` (definition, string, on a part's declaration): the kind of thing the part takes (`arm`,
    `hand`, `face`, `implant`); a part with a socket and nothing installed contributes nothing.
  - `fits` (definition, string, on the installable template): the socket kind it goes into; a
    mismatch is refused `does_not_fit`. A detached limb's companion template (`human.arm_l`) fits its own
    socket, which is reattachment.
  - `installed_in` (state, a part address `<entity>.<part>`) on the installed entity: it rides with
    the body as a held thing does, and the part's capacities are its `contributes` scaled by its
    integrity, as a part's own are.
  - `contributes` (definition) on a partless installable template, the same shape as a part's.
  - The verbs `install` and `extract` (the surgeon's `manipulation`, the part `incised`, see Surgery);
    a removed or destroyed installed entity leaves the socket empty, not the part destroyed.
  - Power and hacking need nothing new: an installed entity may carry `powered_by` and `controlled_by`
    (see Control).
  Open: whether a socket nests (a hand socket on an installed arm); whether capacities may pass 100 for
  augments, or 100 stays the ceiling and an augment only restores; whether `attack` on an installed part
  harms the installed entity or the body; and whether rejection or wear is a process on the installed
  entity.
- **Identity by appearance.** Scenes: Face/Off (a face and voice swapped between two bodies), a disguise, a
  shapeshifter. Today an actor names every other thing by an alias hashed from the observer and the
  entity's id (`docs/actor-view.md`), so a body keeps its alias whatever face it wears: the engine itself
  would give a swap away. Needs: what an observer recognises to come from what it senses. Minimal props:
  - `appearance` (state, string, an opaque token, never prose) and `voice` (state, string) on an agent or
    on the installed entity that carries them (a face, a voice chip, see Sockets).
  - `appearance_part` (definition, string) on the body's template: the part whose installed entity, if
    any, supplies `appearance`; otherwise the body's own prop is read.
  - The rule: an observer that senses a body by sight only gets an alias hashed from the observer and
    the `appearance`; by hearing only, from the `voice`; by touch or smell, from the id, as today. Two
    bodies with one appearance get one alias, and a command naming it is `ambiguous`.
  Open: whether smell (a dog) and touch see through a disguise; whether an observer who has seen both
  aliases on one body ever links them (that is knowledge, which the engine does not keep), whether
  the omniscient record (`trace`, `since`) keeps naming by id (it should), and how many goldens the
  alias change rewrites.
- **Afflictions written by the author.** Scenes: a curse that weakens, a poison that slows, a drug that
  boosts. Today a modifier is made only by `attack` (a stun) and `modifiers` is a derived field the author
  cannot write; a template process can only adjust an integer prop. Needs: an author's way to lay a
  timed modifier. Minimal: an edit kind `afflict { target, capacity, amount, until }` (author only) that
  adds one modifier, signed, expiring at `until` as a stun does, under an `afflicted` event; a lasting
  curse is a prop with a process that re-lays it. Open: whether a beat may carry `afflict` (a scheduled
  curse), whether a negative amount on a structural capacity is ever allowed, and whether an affliction
  is a named thing a `fact` can ask about or only its effect on capacities.
