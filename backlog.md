# Backlog

One item = one small block: plan it, build it, `WORLD_ENGINE_DEEP=1 dotnet test WorldEngine.slnx`, review
the diff, commit. Each item keeps every invariant in AGENTS.md (determinism, pure core, JSON only in the codec, no prose,
coverage-governed `"unknown"`). Delete an item in the same commit that ships it — git history
records it; `docs/` describes what is built (index: `docs/DESIGN.md`).
Measurements and test results live in `docs/measurements.md`, not here; an item quotes a number only
when the item is about that number.

**Scope line.** The engine is a library: a typed, in-process API through which a caller manipulates
objects, humans and animals and asks about the world. The CLI is one thin adapter over that API, and
there is no web server. Turning prose or intent into calls, and choosing calls that reach a desired
world state, is the job of a middleware that does not exist and is not part of this project. Items
below may make the API easier for such a caller to drive (describing its own commands, dry-running
one, structured refusals), but never interpret text or plan on a caller's behalf.

## Priorities

Work top to bottom; take the first entry that is not blocked. Reorder here, nowhere else.

1. [Possession: a curse makes a body act only at another's word](#possession-a-curse-makes-a-body-act-only-at-anothers-word).
2. [Blind and deaf: a body that cannot see, or cannot hear](#blind-and-deaf-a-body-that-cannot-see-or-cannot-hear).
3. [Bound: a body or a part tied, taking what it gives](#bound-a-body-or-a-part-tied-taking-what-it-gives).
4. [Wounds: a cut opens a part without severing it](#wounds-a-cut-opens-a-part-without-severing-it).
5. [Treatment: stopping a bleed, closing an incision](#treatment-stopping-a-bleed-closing-an-incision).
6. [Sockets: install a limb or an implant into a severed part, and reattach](#sockets-install-a-limb-or-an-implant-into-a-severed-part-and-reattach).
7. [Scheduled outcomes: an install decided later, by the dice](#scheduled-outcomes-an-install-decided-later-by-the-dice).

When nothing above is unblocked, stop and report. Gaps with no plan yet are in
[plans/candidates.md](plans/candidates.md); they are not work, and only the maintainer promotes one
to an item here.

## How the work runs

One item at a time on `main`. Sessions that run in parallel each work in their own git worktree and
commit only their own files. Additions to the shared registration points (`VerbRegistry.cs`,
`VerbSpecs.cs`, `Model/Code.cs`, the contract in `src/WorldEngine.Contract`, the `docs/verbs.md`
index, `CLAUDE.md`) are one line or one entry each, so parallel work conflicts at most trivially.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- Named coarse levels (`empty`/`half`/`full`, `fresh`/`stub`): the middleware translates them into the
  percentage and condition forms (`docs/forms.md`), unless several callers need them or they hold an
  invariant.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
- More than single-parent `extends`: several parents, trait bundles, categories nothing reads, and
  see-through barriers (`docs/templates.md`).
- `move` suggesting where to stand: a free spot within reach of each thing is a position chosen to reach
  something, which is planning; `suggest` lists ids, never positions.
- A `distance` query: facts are true, false or unknown, and positions are in every observation.
- The verbs `turn` (it needs a facing direction), `use` (too general), `throw` (it would deal impact damage
  to agents) and `bandage` (a bleed stops by its count).
- Pathfinding: a caller routes around a barrier in several moves. Agents acting in parallel: a `beat` is an
  ordered batch.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

Two chains, promoted from `plans/candidates.md` together: a magical curse (Afflictions → Command provenance →
Possession, then the conditions Blind and deaf, and Bound) and a cyberpunk clinic (Wounds → Treatment → Sockets → Scheduled outcomes). Each item names the
code it touches; where an item says "as X does", read X first and follow it. The shared registration points
(`VerbRegistry.cs`, `VerbSpecs.cs`, `Model/Code.cs`, `EventPerception`'s table, the contract, `docs/verbs.md`)
get one line or entry each; a new verb follows the `new-verb` skill (`.claude/skills/new-verb`).

Every surgery and socket verb below takes the **body as its target and the part in `args.part`** (an `ArgSpec`
naming a part of the target's template; unknown is `invalid_args`). Not a `<body>.<part>` address: an address of a
detached part does not resolve (`Resolve.cs`, the part branch), and `install` and `staunch` must reach a stump.
Each also requires the body within the actor's reach (`Reach.InReach`), else `out_of_reach` (existing code); an
actor may work on its own body.

### Possession: a curse makes a body act only at another's word

- **What:** a body can be possessed through a link entity, and while the possession holds the body's own commands
  are refused and the possessor's (sent with `Via`) pass. A separate mechanism from `controlled_by`: that walk
  requires power from every link, the body included (`Power.FaultOn`), so a curse on a human would always be
  `unpowered`. Devices keep `controlled_by` unchanged.
- **Props** (`Engine/Prop.cs` and its table, `docs/fields.md`):
  - `possessed_by` (state, id) on the body: the link.
  - `possessor` (state, id) on the link: the agent in control.
  - `lapses_at` (state, integer, min 0) on the link: the first tick the possession no longer holds; absent, it
    holds until the link goes.
- **A new template** `templates/curse.json`: `abstract: true` like `templates/anchor.json`, no parts. Adding it
  changes `templates_hash` (existing stored worlds need `upgrade`; say so in the commit message).
- **Rules:**
  - `Possession.Holder(snapshot, body)` (new, `Engine/Physics/Possession.cs`): the possessor's id when the body's
    `possessed_by` names an existing, not destroyed link whose `possessor` is an existing, not destroyed agent and
    whose `lapses_at` is absent or greater than `snapshot.Tick`; else null. Derived each time: no event and no state
    change when it lapses.
  - `Pipeline.Screen`, after the `unconscious` check (so an asleep or unconscious victim stays refused for
    everyone): with a holder, a command whose `Via` is not the holder is refused with a new code `possessed`.
  - Provenance's `not_controller` check accepts `Via == Possession.Holder(...)` as well as the controller.
  - The command runs on the body's capacities; the possessor's own state is not read.
  - `SnapshotValidation`: `possessed_by` and `possessor` join the dangling-reference loop beside `powered_by` and
    `controlled_by`; a `possessed_by` naming itself is refused like a control loop.
  - Ending it early is the author's `update_props` clearing `possessed_by`, or the link destroyed.
  - `Scenes/Forms.cs` `ArchitectProps` gains the three props, so `scenarios/curse.json` can set them.
- **Files:** `Engine/Prop.cs`, `Engine/Physics/Possession.cs` (new), `Engine/Pipeline.cs`, `Scenes/Forms.cs`,
  `Engine/SnapshotValidation.cs`, `Model/Code.cs`, `templates/curse.json`, `docs/possession.md` (new, ≤ 40 lines,
  indexed in `docs/DESIGN.md`), `docs/fields.md`.
- **Tests:** a scenario `scenarios/curse.json` (two humans and a curse linking them, `lapses_at` 5, a seed not needed):
  the victim's own `move` is refused `possessed`; the curser's `move` for it via `actorWorld(victim, via: curser)`
  is accepted; at tick 5 the victim's own `move` is accepted and the curser's refused `not_controller`; a removed
  curse with `possessed_by` still naming it is refused as a dangling reference; a store world folds alike.
- **Non-goals:** sensing through the victim, breaking free by a roll, a `released` event.
- **Done when:** as above.
- **Depends on:** Command provenance.

### Blind and deaf: a body that cannot see, or cannot hear

- **What:** two state props an author sets, as `asleep` is (`docs/senses.md`): `blind` takes sight, `deaf` takes
  hearing. Unlike `asleep`, neither refuses the body's commands: a blind body still acts on what it touches,
  hears or smells.
- **Props** (`Engine/Prop.cs`, `Flag(..., Tier.State)`, `docs/fields.md`): `blind`, `deaf`.
- **Rules:** in both perception checks, `Perception.cs` (entity form) and `EventPerception.cs` (event form), right
  after the `asleep` check and in the same shape: `blind` and the sense is sight → `false` with a new basis code
  `blind`; `deaf` and the sense is hearing → `false` / `deaf`. Nothing else reads them. Their capacity is untouched,
  so `capacity` still reports `sight` 100 for a blind body: the condition is not damage.
- **Scenarios:** `Scenes/Forms.cs` `ArchitectProps` gains `Prop.Blind` and `Prop.Deaf`, beside `Prop.Asleep`.
  A beat may set them (`set_props` / `update_props` are beat edits already), which is how a curse strikes later.
- **Files:** `Engine/Prop.cs`, `Engine/Perception/Perception.cs`, `Engine/Perception/EventPerception.cs`,
  `Model/Code.cs` (two members), `Scenes/Forms.cs`, `docs/senses.md` (two lines beside `asleep`),
  `docs/senses-bases.md` (the two codes), `docs/fields.md`.
- **Tests** (beside the `asleep` perception tests): in a lit room, a blind human does not see a stone in front
  of it (`false` / `blind`) and still touches the one it holds; it hears another's `say`; a deaf human sees the
  `say` and does not hear it (`false` / `deaf`); both still `move` and `take`; `observe` lists for a blind body
  only what touch and smell give; set by a beat at tick 2, the `false` begins at tick 2.
- **Non-goals:** partial blindness, a sense restored by a timer (an author or a beat clears the prop).
- **Done when:** the tests pass, `dotnet test WorldEngine.slnx` and the deep run pass, and no existing golden moves.
- **Depends on:** nothing.

### Bound: a body or a part tied, taking what it gives

- **What:** binding takes capacities the way losing a part does, and is undone by clearing it. Decided
  (`plans/candidates.md` history): bound with no part named takes `moving` and `manipulation`; a bound part takes
  only what that part, and the parts under it, contribute. A bound body still speaks and senses.
- **Model:**
  - Body-wide: a state prop `bound` (`Engine/Prop.cs`, `Flag`), in `ArchitectProps` beside `asleep`.
  - One part: `PartState` gains `bool? Bound` (`Model/Snapshot.cs`), written only when true, absent read as false
    (no schema change). The `set_part` edit's `state` takes an optional `bound` (`Verbs/EditParser.cs`); that is how
    a scene or a beat binds a part, since a scenario does not write part state at tick 0. Wounds and Sockets add
    their own optional fields to the same record and edit: whichever lands second adds beside the first.
- **Rules** (`Engine/Physics/Capacities.cs`, `Structural`):
  - A part that is bound, or has a bound ancestor (the `AncestorsAvailable` walk), contributes nothing.
  - A body with `bound` reads `Structural` 0 for `moving` and `manipulation`, whatever its parts.
  - Both are structural, so `Capacities.Of` follows, and modifiers still add on top as today, clamped to 0–100.
  - What a bound part holds stays held: `Carry.PartAvailable` and the `in_part` rules do not read `Bound`. A bound
    hand cannot take anything new, since its `manipulation` is gone.
  - No event of its own: the change is an `edited` event, as `set_part` and `update_props` already record. No
    `capability_changed` is emitted for it, as for any edit today.
- **Files:** `Model/Snapshot.cs`, `Engine/Physics/PartStates.cs` (default check counts `Bound`),
  `Engine/Physics/Capacities.cs`, `Engine/Prop.cs`, `Verbs/EditParser.cs`, `Scenes/Forms.cs`,
  `docs/structure.md` (a bound part), `docs/state.md` (capacities), `docs/fields.md`, `docs/verbs-edit.md`
  (`set_part` takes `bound`).
- **Tests:** a human with `bound` reads `moving` 0 and `manipulation` 0, `sight` and `speech` 100; its `move` is
  refused `insufficient_moving` and its `say` is accepted; `set_part` binding `hand_l` takes 50 `manipulation`
  (hand 30 and thumb 20) and leaves the right hand's 50; the stone `hand_l` held stays in it; clearing the binding
  (a `set_part` with no `bound`, or `update_props` dropping `bound`) restores every capacity; a beat binds the body
  at tick 3; a store world folds alike.
- **Non-goals:** `bind` and `untie` verbs and the rope they would need, struggling free, binding by a part's
  name other than through `set_part`.
- **Done when:** as above, and no existing golden moves.
- **Depends on:** nothing.

### Wounds: a cut opens a part without severing it

- **What:** a verb `cut`, target the body, `args.part`, that marks the part incised and starts a bleed that names the
  part.
- **Model:**
  - `PartState` gains `bool? Incised` (`Model/Snapshot.cs`), written only when true; `PartStates` keeps treating a
    state equal to the template default as absent (an incised part is never at default). Absent reads false, so
    `schema_version` stays 5.
  - `BleedCause` gains `string? Part`: the part the wound is in. `AttackVerb`'s severing passes the severed part to
    `Schedule.StartBleeding` (new parameter), so every bleed names its part from now on.
  - The `set_part` edit's `state` takes an optional `incised` (`EditParser`), so a scene can start with one.
- **Verb rules** (`Verbs/SurgeryVerbs.cs`, new): one tick. Requires `manipulation` 50 and a held thing whose
  template has the new prop `cuts` (definition, boolean); else refused with a new code `no_cutting_tool`. The part
  must read intact or damaged (`PartStates.Effective`), else refused with a new code `part_unavailable`; already
  incised is refused `already_incised`. The
  transition sets `Incised` under the root `cut` event and calls `StartBleeding(working, body, part, rootEvent)`;
  no integrity damage to the part. A body whose props declare no bleeding is incised and does not bleed.
- **Registration:** `VerbRegistry`, `VerbSpecs` (`Args`: `part`), `Code.cs`, a `["cut"] =
  Audible` row in `EventPerception`, `docs/verbs.md` index line to a new `docs/verbs-surgery.md`.
- **Templates:** `templates/scalpel.json` (a small held thing with `cuts: true`); changes `templates_hash`.
- **Files:** `Model/Snapshot.cs`, `Engine/Physics/PartStates.cs`, `Engine/Scheduling/Schedule.cs`,
  `Verbs/AttackVerb.cs`, `Verbs/EditParser.cs`, `Verbs/SurgeryVerbs.cs`, the registration points,
  `templates/scalpel.json`, `docs/verbs-surgery.md`, `docs/bleeding.md` (a bleed names its part).
- **Tests:** a human holding a scalpel cuts another's `arm_l`: the arm stays attached and `intact`, its part state
  reads `incised`, capacities unchanged, and the body takes `bleed_damage` every `bleed_every_ticks` for
  `bleed_times`; the schedule's bleed names `arm_l`; a cut with no scalpel is refused `no_cutting_tool`; a second
  cut `already_incised`. Goldens: any fixture holding a stored bleed gains `part` (regenerate with
  `WORLD_ENGINE_UPDATE_GOLDENS=1`, read the diff: only `part` may appear).
- **Done when:** as above.
- **Depends on:** nothing.

### Treatment: stopping a bleed, closing an incision

- **What:** two verbs in `Verbs/SurgeryVerbs.cs`, target the body, `args.part`, one tick, `manipulation` 50, no tool:
  - `staunch`: removes every `BleedCause` of that body whose `Part` is the part, from the schedule. Refused
    `not_bleeding` (new) when there is none.
  - `suture`: clears `Incised` on the part. Refused `not_incised` (new) when it is not incised. It does not stop a
    bleed: a severing bleeds with no incision, and an incision may be closed before or after staunching.
- **Rules:** a bleed with no `Part` (none after Wounds; kept for a world stored before it) is never staunched. The
  removal is recorded under the root `staunch` event (`Working.SetSchedule`).
- **Registration:** as Wounds; rows `["staunch"] = Audible`, `["suture"] = Audible`; `docs/verbs-surgery.md`.
- **Tests:** two wounds on one body (a cut arm and a severed hand): `staunch` on the arm stops its bleed (no
  `damaged` from its chain after the staunch) and the hand's bleeds on to its count; `suture` clears the incision
  and leaves any remaining bleed; the refusals change nothing.
- **Done when:** as above.
- **Depends on:** Wounds.

### Sockets: install a limb or an implant into a severed part, and reattach

- **What:** a severed part can be filled again, either by its own severed limb (reattachment) or by an entity
  made to fit it (a robo-arm). Installing reverses severing: the entity is absorbed into the body's part state, as
  `AttackVerb.DetachPart` spawns one out of it. Parts have no identity until they detach (`docs/structure.md`),
  and an installed part keeps to that.
- **Templates:**
  - A new top-level template field `fits` (`Templates/TemplateModel.cs`, `TemplateShape`, `TemplateValidation`):
    the id of the companion template it stands in for (`human.arm_l`). An installable template must have the same
    part names, parents and `holds` as that companion (reuse the subtree check `DetachPart` makes); its own
    `contributes` and `max_integrity` are its own. A companion template fits itself without declaring `fits`.
  - `templates/robo_arm_l.json`: `fits: "human.arm_l"`, its `hand_l` contributing `manipulation` 40 and its
    `arm_l` and `thumb_l` 0, so a test can tell its sum from the human's (30 + 20). Changes `templates_hash`.
- **Model:** `PartState` gains `string? Installed`: on the root part of an installed subtree, the installable
  template's id; absent for the body's own parts (and for a reattached limb, which is its own again). The
  `set_part` edit's `state` takes an optional `installed`, validated as `install` validates it.
- **Capacities:** `Capacities.Structural` reads a part's `contributes` from the installed template's part of the
  same name when the part or an ancestor has `Installed`; otherwise from the body's template. Holding (grips) is
  unchanged: the parts are the body's parts.
- **Verbs** (`Verbs/SocketVerbs.cs`, new), target the body, `args.part`, one tick, `manipulation` 50:
  - `install`, `args.item`: an entity the actor holds. The part must be `detached` (the stump), else
    `socket_occupied` (new); the item's template must be the part's companion template or fit it, else
    `does_not_fit` (new). The transition removes the item (`Physical.RemoveEntity`), writes the subtree's states
    from the item's parts (as `DetachPart` copied them out, in reverse), sets `Installed` when the item is not the
    companion, and emits a consequence `installed { part, template }` (new `EventType`, `Audible`).
  - `extract`: the part must have `Installed`, else `nothing_installed` (new). It spawns an entity of the
    installed template at the body's feet with the subtree's states, sets the root part `detached`, clears
    `Installed`, and emits `extracted { part, entity }` (new `EventType`, `Audible`). A reattached limb has no
    `Installed` and cannot be extracted; attack severs it as before.
  - `AttackVerb.DetachPart` spawns the root part's `Installed` template, when set, instead of the companion.
- **No surgery in this item:** installing needs no incision. A later item may require one.
- **Files:** `Templates/TemplateModel.cs`, `TemplateShape.cs`, `TemplateValidation.cs`, `Model/Snapshot.cs`,
  `Engine/Physics/Capacities.cs`, `Engine/Physics/PartStates.cs`, `Verbs/AttackVerb.cs`, `Verbs/EditParser.cs`,
  `Verbs/SocketVerbs.cs`, the registration points, `templates/robo_arm_l.json`, `docs/sockets.md` (new, ≤ 40
  lines, indexed), `docs/structure.md` (one line), `docs/templates.md` (`fits`).
- **Tests:** a human whose `arm_l` is severed reads `manipulation` 50 (the right hand); after `install` of the
  robo-arm it reads 90 (50 + 40), against 100 for an intact human; after `extract` the robo-arm is a thing at the body's feet and
  the arm reads `detached`; the severed `human.arm_l` installed back reads the capacities and part states it had
  when severed and has no `Installed`; a mismatched template is refused `does_not_fit`; an attack that severs the
  installed arm spawns a robo-arm, not a `human.arm_l`; a store world folds alike.
- **Non-goals:** nested sockets, rejection or wear, power or hacking of an installed part (it is no entity while
  installed), a change of the body's class.
- **Done when:** as above.
- **Depends on:** nothing (Wounds and Treatment are not needed by it).

### Scheduled outcomes: an install decided later, by the dice

- **What:** an installable template may declare that installing it is an attempt: `install` then schedules an
  outcome instead of installing, and the world's dice decide it at a due tick. Between the two, anything may
  happen: the patient attacked, the implant taken away.
- **Props** (definition, on the installable template): `success_pct` (integer 0–100), `outcome_ticks` (integer ≥ 1),
  `failure_damage` (integer ≥ 0, default 0). A template with `outcome_ticks` is an attempt; one without installs at
  once, as Sockets.
- **Model:** a fifth cause `OutcomeCause(DueTick, Entity = body, CauseId, Part, Item, Actor)` in
  `Model/Snapshot.cs` with its `CauseKind.Outcome`, its `Kind` arm, its `Schedule.Run` case, its stored shape in the
  contract and `SnapshotValidation` (dangling body or item refused, as other causes are).
- **Rules:**
  - `install` of an attempt template runs every check Sockets runs, then emits `outcome_scheduled { part, item }`
    (new `EventType`, `Silent`) and adds the cause; the item stays where it is (in the actor's hand). A world with
    no seed refuses it `no_seed` unless `success_pct` is 100.
  - At the due tick: the body or the item gone, the cause is pruned and emits nothing (as a beat's subject gone).
    Otherwise the part must still be detached and the item within the body's reach (`Reach.InReach(body, item)`);
    if not, `outcome_failed { reason: "out_of_reach" | "socket_occupied" }`. Else one roll (`Working.Random()`, not
    drawn at 100): under `success_pct` emits `outcome_succeeded` and performs Sockets' install transition caused by
    it; otherwise `outcome_failed { reason: "roll" }` and `failure_damage` to the body's integrity through
    `Harm.Apply`, caused by it. Both new `EventType`s are `Silent`.
  - The odds read nothing but `success_pct`.
- **Files:** `Model/Snapshot.cs`, `Model/CauseKind.cs`, `Engine/Scheduling/Schedule.cs`, `Engine/Prop.cs`,
  `Verbs/SocketVerbs.cs`, `Engine/SnapshotValidation.cs`, `Engine/EventType.cs`, `EventPerception`, the contract's
  stored schedule shape, `docs/schedule.md` (five kinds), `docs/sockets.md`, `templates/robo_arm_l.json` (gains
  the three props; hash changes again).
- **Tests:** with a fixed seed, an attempt at 50 resolves the same on a memory world, a store world and a replay; a
  surgery at 100 needs no seed; an attack on the patient during the pending ticks lands before the outcome and both
  are in `trace` in order; the implant dropped in another room before the due tick fails `out_of_reach`; the
  implant removed by the author prunes the cause with no event; `trace` of the installed part reads `install` →
  `outcome_scheduled` → `outcome_succeeded`.
- **Done when:** as above.
- **Depends on:** Sockets.
