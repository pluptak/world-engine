# Candidates

Known gaps with no plan yet. **Not work for a coding agent:** nothing here is ready, and each entry
ends in open questions that are the maintainer's to settle. A candidate is promoted by writing it
up as an item in `backlog.md` (its files, types, tests and done-condition) and adding it to the
Priorities there, then deleting it here in the same commit.

- **Who authors templates: a template library, worlds and runs, all by revision.** Today the
  catalogue is `templates/`, an architect picks presets and never writes one, and a world author
  changes state, never a definition; a stored world freezes its resolved set in `templates.json`.
  Decided by the maintainer:
  - **Templates are fixed building blocks.** No scene brings templates of its own, and no world or run
    creates or changes one: nothing mid-world. The set a run uses never changes while it runs.
  - **A template library with its own CLI flow** (list, get, put, delete), touching the library only.
    For now the library is `templates/`.
  - **Template revisions.** A put never overwrites: it writes a new revision of the template, and a
    revision never changes once written. Every write validates the whole latest set as loading does
    (shape, `extends`, companions, products, successors) and writes nothing when it breaks.
  - **Worlds in a library, by revision.** A world is a scenario source and a manifest pinning a
    revision for every template id it uses: linked, not copied. Editing a world writes a new world
    revision; a world's CLI flow is add, edit (a revision), delete.
  - **Runs from a world revision.** A run is played from one world revision, pinned with the template
    manifest it was built with, and maps back to that revision. Before a run starts the caller chooses,
    per template with a newer revision, the pinned one or the newer; the chosen set is validated as a
    whole, the scene's entries against it, and the run's initial state is built from the scenario with
    it (`WorldBuilder.Restart` copies a built world today). A fresh run has no log, so no lost-field
    check (`UpgradeTemplates`) is needed.
  - **Deleting.** A template revision any world revision or run names cannot be deleted; past runs
    survive a world's later revisions. Deleting a world deletes all its revisions and every run made
    from them, which frees the template revisions only they named. Since revisions are immutable, a
    new revision never needs to wait for a running simulation.
  - **Choosing revisions.** A separate request lists, for a world revision, the templates with newer
    revisions than it pins; the run-start request takes the choices, and a template it names no choice
    for keeps its pinned revision.
  - **Numbering.** A revision is a counter (1, 2, 3) per template and per world; the hash still checks
    what was pinned.
  Possible representation: `templates/<id>.json` stays the latest revision, so the loaders, the CLI's
  shipped set and the suite read what they read today; older revisions under
  `templates/.revisions/<id>/<n>.json`; `templates_hash` over the pinned revisions. Requirement, not a
  choice: the suite reads `templates/` and its goldens pin it, so a new latest revision moves goldens
  until the library has a directory of its own. A run linked to the library is no longer a
  self-contained directory (`verify`, `restart`, copying it away need the library beside it).
  Decided: the library leaves `templates/` for a directory of its own as soon as a template is written
  for a story rather than for the engine; `templates/` then stays the set the engine is tested against.
  Non-goals: exporting a run with its pinned revisions copied in, until a run has to leave the library.
- **Facing and a sight cone for bodies.** In a lit room every act is seen (`docs/limits.md`); the
  costliest of the limits, revisit when a concrete world needs what darkness, concealment and
  staging cannot give. A camera's cone is built (`docs/camera.md`); a body's would also need a facing that
  changes as it moves or turns, and `turn` is out of scope. Open: who sets a body's facing, and
  whether hearing or touch ever reads it.
- **Conditions.** `asleep` and `unconscious` are built (`docs/senses.md`); blind, deaf and bound are
  backlog items. Decided by the maintainer:
  - **Gagged** blocks speech down to sound: no message gets through. A gagged `say` is not refused. The
    speaker is told by a `garbled` line on its own hearing, so it knows others will hear or understand it
    poorly. The garble is a flag on the heard event, not scrambled words: hearers already get only a
    sound, and scrambling would make the engine produce text, which the no-prose rule forbids.
  - Open: which scene needs it.
- **A room going dark.** Decided: when a room goes dark, every sighted participant in it is blind until
  the light is back on. No per-participant condition: the unlit rule already makes sight false in a dark
  room, which is that blindness, and a condition would duplicate it and need upkeep as the light changes.
  What is added is a `darkened` event on the room, emitted when `isLit` turns false within a command. A
  sighted participant keeps the basis `location_unlit`. Open: whether a scene row needs the event at all.
- **`wait` outside a run.** A running run already refuses `wait` (`round_only`, `src/engine/run.ts`).
  Decided: `wait` stays in worlds with no run, since the suite and single-agent worlds use it. Removing it
  would rewrite many tests for no gain.
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
