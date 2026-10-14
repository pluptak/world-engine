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

- **A body changing hands during a run.** Behaviour: in a run, a player can come to drive another body
  (a mind swap), and the body's moves go with it. Today a body cannot join or leave a slot during a run
  (`docs/roles.md`, "Not in it"); a successor is the only hand-over, and only on destruction. Possible
  representation: an edit kind `transfer_body { body, slot }` for the director and the author.
  Trigger: a run scene where two players swap bodies, or one takes another's.
  Depends: nothing; independent of Possession (`backlog.md`), which works outside runs too.
  Non-goals: a slot with no body, a body in two slots.
  Test: after a transfer, the receiving handle's `submit` for the body is accepted and the former
  handle's is refused `not_a_body`; the body's state is unchanged by the transfer.
  Decided: a move already submitted for the body goes with it to its new player, as a successor's does.
  Open: whether this changes the general rule in `docs/roles.md` (a body may change slots during a run)
  or stays a rule for swaps only, the narrower one and easier to test; the run's lifecycle is to be
  checked against either.
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
  Depends: Scheduled outcomes (`backlog.md`), when a character's attempt triggers it; nothing, when a beat does.
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
  Depends: Sockets (`backlog.md`), for a face that moves between bodies; nothing, for an `appearance` an author sets.
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
