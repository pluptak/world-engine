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
- **A storage seam.** A `WorldStore` interface of storage primitives (snapshot, log, events and deltas,
  checkpoints, templates, ids, an exclusive turn) with the file store and the memory world behind it and
  one driver and one set of folds over both, so a second backend such as SQLite is one more store
  (`plans/storage-seam-design.md`, approach B). Deferred by the maintainer after the .NET port: `Submission`,
  `WorldReads`, `Trace`, `Projection` and the actor, player and director views already serve both worlds
  from Core, what stays twice is `MemoryWorld` against the store's replay and history folds, conformance
  tests already hold the two alike, and nothing asks for another backend.
  Trigger: a real need for one (a world too large for files, several processes writing one world, a host
  that requires a database).
  Note: the design doc is written against the TypeScript (`src/api.ts`, `file-store.ts`, `npm run
  check:changed`, the TS dependency list) and is re-read for .NET before promotion.

The entries below come from three story genres (a magical world's curses, cyberpunk augmentation, a
Face/Off swap). Each states the behaviour first and then one possible representation, which is a
sketch, not a decision. **Trigger** names what would justify promoting it, **Depends** what must exist
first, and **Non-goals** what its first version leaves out.

- **Wounds: a cut that opens a part.** Behaviour: a part can be cut open without being severed; an
  open part bleeds until it is closed, and is the part something can be put into or taken out of. Today
  the only cut is `attack`, which severs a part whole, and a bleed is the body's (`docs/bleeding.md`): it
  starts on a severing and does not name the part it came from. Possible representation: part state
  `incised` (state, boolean); a verb `cut` needing `manipulation` and a held thing able to cut; the
  `bleed` cause naming its part.
  Trigger: a surgery scene, or any scene with a wound that is not a severing.
  Depends: nothing; unconscious is built (`docs/senses.md`), so a patient need not feel or act through it.
  Non-goals: depth or size of a wound, infection, scars.
  Test: a cut on a human's arm leaves the arm attached and `damaged`, its capacities as they were, and
  `damaged` events on the body every `bleed_every_ticks` until the count ends; a severing still bleeds
  as today.
  Decided: cutting needs a held thing with a prop able to cut plus `manipulation`, no new capacity; an
  incision is part state that lasts until it is closed, not a modifier that expires.
- **Treatment: stopping a bleed.** Behaviour: an agent can stop one bleed on a body, and separately close
  an open part. Today a bleed stops only by its count running out or by an edit removing the body's
  bleed props, which stops every wound at once. Possible representation: a verb that ends the bleed cause
  naming a part, and one that clears `incised`.
  Trigger: a scene where a wound must be stopped before its count ends.
  Depends: Wounds (a bleed that names its part).
  Non-goals: healing integrity back; `bandage` stays out of scope as a word, the behaviour is this one.
  Test: of two wounds, the treated one stops (no `damaged` from its cause after the treatment) and the
  other bleeds on to its count.
  Decided: stopping a bleed and closing an incision are two acts, since a severing bleeds with no
  incision to close; treatment is a verb.
- **Sockets: a part filled by another entity.** Behaviour: a part can hold an entity installed in it, and
  the part's capacities are then that entity's; with nothing installed the part contributes nothing. The
  installed entity is a real thing: it can be carried before, taken out after, powered and controlled.
  Today only declared parts exist and a part's `contributes` is fixed by its template, so an arm that
  replaces another is never a thing anyone holds. Possible representation:
  - `socket` (definition, string, on a part's declaration): the kind of thing the part takes (`arm`,
    `hand`, `face`, `implant`).
  - `fits` (definition, string, on the installable template): the socket kind it goes into; a
    mismatch is refused `does_not_fit`.
  - `installed_in` (state, a part address `<entity>.<part>`) on the installed entity: it rides with the
    body as a held thing does, and the part's capacities are its `contributes` scaled by its integrity,
    as a part's own are; `contributes` (definition) on a partless installable template, a part's shape.
  - The verbs `install` and `extract`; a removed or destroyed installed entity leaves the socket empty,
    not the part destroyed. Power and hacking reuse `powered_by` and `controlled_by`.
  Trigger: a cyberpunk scene with one implant or limb that is installed, used and taken out.
  Depends: nothing for a socket that needs no surgery (equipment); Wounds when a socket is reached only
  through an open part, which a part's declaration would say, not every socket.
  Non-goals: nested sockets (a hand socket on an installed arm), rejection and wear, a change of the
  body's class (see Class changes).
  Test: a human whose `arm_l` socket is empty reads that arm's capacities as zero; after `install` of a
  robo-arm they are the robo-arm's `contributes`; after `extract` the robo-arm is a thing on the floor
  or in a hand and the arm reads zero again; a mismatched `fits` is refused and changes nothing.
  Decided: `attack` on an installed part harms the installed entity, as a blow on a part harms that
  part; an installed entity contributes its own amounts, within the 0–100 ceiling, whatever the replaced
  part gave.
- **Reattachment.** Behaviour: a severed part can be joined back on, and its subtree's state comes with it.
  Possible representation: a detached part's companion template (`human.arm_l`) `fits` the socket it came
  from, so reattaching is `install`.
  Trigger: a surgery scene that sews a severed limb back on.
  Depends: Sockets, Wounds.
  Non-goals: a part from another body of another template (that is an implant, not a reattachment).
  Test: a severed `human.arm_l` installed back reads the capacities and part state it had when severed.
  Decided: reattaching is `install`; the reattached part is the body's own part again, and the severed
  entity is removed.
- **Control links that are not devices.** Behaviour: an agent can control a body through something other
  than a cable or a panel (a curse, a hacked implant); the control can lapse at a tick or end when the
  link is destroyed, and while it holds either the body acts only at its controller's word, or both act.
  Today `controlled_by` walks physical links only (`docs/power.md`), and the agents it controls (an arm, a
  terminal's door) have no will of their own. Remote control of devices is built and is not this entry.
  Possible representation: `controlled_by` naming an abstract link entity (`templates/anchor.json`
  style); `lapses_at` (state, integer tick) on the link, removed by the clock with a `released` event;
  `overrides_will` (definition, boolean) on the link's template, refusing the body's own commands
  `controlled`.
  Trigger: a magical scene where a curse makes a victim act for another (Imperius).
  Depends: Command provenance, for a link that overrides the body's will.
  Non-goals: perception through the controlled body (the controller seeing what it sees), resisting the
  link by social means.
  Test: while a curse link holds, the victim's own `move` is refused `controlled` and the curser's
  `move` for it is accepted; at `lapses_at` a `released` event falls and the victim's own `move` is
  accepted again.
  Decided: the first version ends a link only by `lapses_at` or by destroying the link; a link that
  shares control waits for a scene.
  Open: whether breaking free is ever a roll on the link (`jam_pct`-style, with a seed): deferred until
  a scene needs an escape whose rules and consequences are concrete.
- **Command provenance.** Behaviour: the engine knows which agent issued a command, apart from the body
  that carries it out, and refuses a command its issuer may not give. Today both a body's own command and
  its controller's arrive through `actorWorld(body)`, so the pipeline cannot tell them apart; `by`
  records the role a command was sent under (`docs/roles.md`), not the agent behind it. Possible
  representation: a command field `via`, the issuing agent, set by the controller's handle as `by` is set
  by a role and checked against the end of the control walk.
  Trigger: Control links with `overrides_will`, or any scene where two agents command one body.
  Depends: nothing.
  Non-goals: authorising by intent or persuasion.
  Test: one body, two issuers: the log records each command's issuer, a replay gives the same snapshot,
  and a command from an issuer at no end of the body's control walk is refused.
  Decided: the controller's handle is `actorWorld(body, { via })`; `via` is logged and replayed as `by`
  is.
- **A body changing hands during a run.** Behaviour: in a run, a player can come to drive another body
  (a mind swap), and the body's moves go with it. Today a body cannot join or leave a slot during a run
  (`docs/roles.md`, "Not in it"); a successor is the only hand-over, and only on destruction. Possible
  representation: an edit kind `transfer_body { body, slot }` for the director and the author.
  Trigger: a run scene where two players swap bodies, or one takes another's.
  Depends: nothing; independent of Control links, which work outside runs too.
  Non-goals: a slot with no body, a body in two slots.
  Test: after a transfer, the receiving handle's `submit` for the body is accepted and the former
  handle's is refused `not_a_body`; the body's state is unchanged by the transfer.
  Decided: a move already submitted for the body goes with it to its new player, as a successor's does.
  Open: whether this changes the general rule in `docs/roles.md` (a body may change slots during a run)
  or stays a rule for swaps only, the narrower one and easier to test; the run's lifecycle is to be
  checked against either.
- **Scheduled outcomes.** Behaviour: a command starts an attempt whose result is decided later, at a due
  tick, by the world's seeded dice; success and failure apply their own effects, and the chain
  decision → attempt → result is one `cause_id` chain. Possible representation: a schedule kind `outcome`
  (`docs/schedule.md`) stored with the body and the procedure entity; events `outcome_scheduled`,
  `outcome_succeeded`, `outcome_failed`; definition props on the procedure's template: `success_pct`
  (0–100; 100 never rolls, so it needs no seed), `outcome_ticks`, `failure_damage` (optional). A world
  with no seed refuses the starting command `no_seed`.
  Trigger: a scene where something must be able to happen while the attempt is pending (the patient is
  attacked mid-surgery, the implant is taken from the table). Without one, a verb with a declared
  duration that rolls inside the command already gives attempt, roll and result, and this is not needed.
  Depends: nothing; its effects (an install, a class change) are other entries.
  Non-goals: odds that change while pending, partial success.
  Test: with one seed, an attempt at `success_pct` 50 succeeds on replay exactly as it did first; an
  attack during the pending ticks lands before the outcome, and `trace` reads command →
  `outcome_scheduled` → `outcome_succeeded` or `outcome_failed`.
  Decided: the body acts freely while its outcome is pending (a scene makes it `unconscious` when it
  should not); the first odds are the procedure's alone, no skill; a pending outcome is cancelled, and
  pruned as a beat's is, when its body or procedure entity goes.
- **Class changes.** Behaviour: a body becomes another class, with the larger or smaller absolute amounts
  of that class, by a world event (a curse taking hold, an upgrade succeeding), never inside the command
  that starts it. Decided by the maintainer:
  - Capacities keep their 0–100 ceiling. A capacity is a share of what the body's class can do, and the
    class is the template: its definition props are the absolute amounts (`hand_carry_limit_g`,
    `attack_damage`, `reach_cm`, part `max_integrity`). A stronger body is another class: `cyborg`
    extends `human` with larger amounts, so a cyborg at 100 out-lifts and out-hits a human at 100.
  - The change is triggered by a world event: a beat, or a Scheduled outcome's success.
  Possible representation: `refine` (`docs/refine.md`) as the change, which a beat may then carry
  (`docs/beats-actions.md` lists the edits a beat carries; `refine` is not among them today);
  `grants_class` (definition, string) on a procedure's template; for changes `refine` does not allow (it
  only moves to a template that extends the entity's own, so not `cyborg` → `human` or `werewolf` →
  `human`), a template key `becomes` listing the classes a body may change into, any other refused
  `not_a_class_change`.
  Deferred: the first cyber-arm may need only Sockets, the arm's amounts being the installed entity's.
  Promote this only for a scene that needs a body-wide change Sockets cannot give.
  Trigger: a magical scene where a curse turns a human into another kind of body (a werewolf).
  Depends: Scheduled outcomes, when a character's attempt triggers it; nothing, when a beat does.
  Non-goals: changing into a template that is no agent, or merging two classes.
  Test: a human at 100 cannot lift what a cyborg at 100 can; after the beat refines the human to
  `cyborg`, it can, and its integrity and held things are as they were.
  Decided: part state the new class does not declare is refused, as `refine` refuses it; a beat's
  refused class change is recorded `beat_skipped { reason: "failed" }` and its watch goes on, as a
  refused edit's does.
  Open: whether a class is the whole body's or a part's (one cyber-arm), TBD; whether a class ever goes
  back, and so whether `becomes` is wanted at all, TBD. Both are decided together when a scene promotes
  this entry.
- **Identity by appearance.** Behaviour: what an observer recognises a body by comes from what it
  senses, so a body wearing another's face is, to someone who only sees it, the other. Today an actor
  names every other thing by an alias hashed from the observer and the entity's id
  (`docs/actor-view.md`), so a body keeps its alias whatever face it wears: the engine itself would give
  a swap away. Invariant: what an actor perceives and what it can address stay one: the alias in its
  observation is the alias a command of its resolves, and no alias, fact or event in its view leads back
  to the id. Possible representation: `appearance` and `voice` (state, opaque string tokens, never
  prose) on the body or on the installed entity carrying them (a face, a voice chip);
  `appearance_part` (definition, string) on the body's template; an alias from the observer and the
  `appearance` when the body is only seen, from the `voice` when only heard, from the id when touched or
  smelt. Two bodies with one appearance share one alias, and a command naming it is `ambiguous`; one
  body seen under two appearances is two aliases, as a disguise should be.
  Trigger: a Face/Off scene, or a disguise an observer must be fooled by.
  Depends: Sockets, for a face that moves between bodies; nothing, for an `appearance` an author sets.
  Non-goals: an observer linking two aliases to one body (knowledge, which the engine does not keep).
  Test: after A and B swap `appearance`, an observer that only sees them gets A's former alias for B,
  and a command naming that alias acts on B; an observer that touches B gets B's own alias; no
  observation of the seeing observer contains B's id.
  Decided: touch and smell see through a disguise (the alias from the id, as today). Requirement, not a
  choice: the omniscient record (`trace`, `since`, `perceivers`) keeps naming by id.
  Open: which identity an observer is given when it both sees and hears a body whose face and voice
  disagree. Preferred first: report the seen appearance and the heard voice apart, and choose one alias
  only if addressing needs one; then sight is the default, written as a policy of its own. How many
  goldens the alias change rewrites is an estimate for the promotion, not a question.
- **Afflictions written by the author.** Behaviour: the author can lay a timed change on a body's
  capacity (a curse that weakens, a poison that slows, a drug that helps) that expires on its own, as a
  stun does. Today a modifier is made only by `attack`, `modifiers` is a derived field the author
  cannot write, and a process only adjusts an integer prop. Possible representation: an edit kind
  `afflict { target, capacity, amount, until }` (author only) adding one signed modifier under an
  `afflicted` event; a lasting curse is a prop with a process that re-lays it.
  Trigger: a scene with a curse or a poison whose effect must wear off by itself.
  Depends: nothing.
  Non-goals: a beat carrying `afflict` until the edit's own rules are settled; a named affliction a
  `fact` can ask about.
  Test: a body at `moving` 100 under an affliction of -50 `moving` reads 50 while it holds and 100 once
  it has expired: an affliction laid at tick 0 `until` 3 reads 50 at ticks 0 to 2 and 100 from 3, with
  its `capability_changed` at 3 caused by the `afflicted`.
  Decided: `until` is the first tick the modifier no longer holds, as a stun's expiry is
  (`docs/time.md`: a blow at 0 expires at 3); afflictions stack as modifiers already do, summed with the
  parts and clamped to 0–100 (`docs/state.md`), and nothing more; one on a capacity whose part is
  destroyed or severed still expires as usual and the clamp keeps the capacity at 0; structural capacity
  leaves modifiers out, so no affliction lowers it.
