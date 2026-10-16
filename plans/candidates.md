# Candidates

Known gaps with no plan yet. **Not work for a coding agent:** nothing here is ready, and each entry
ends in open questions that are the maintainer's to settle. A candidate is promoted by writing it
up as an item in `backlog.md` (its files, types, tests and done-condition) and adding it to the
Priorities there, then deleting it here in the same commit.

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
- **A room going dark, and a device losing power.** Decided: when a room goes dark, every sighted
  participant in it is blind until the light is back on. No per-participant condition: the unlit rule
  already makes sight false in a dark room, which is that blindness, and a condition would duplicate it
  and need upkeep as the light changes. What is added is a `darkened` event on the room, emitted when
  `isLit` turns false within a command. A sighted participant keeps the basis `location_unlit`.
  Evidence (the first LLM run, below): the director's `power_cut` beat left one event, `edited` on the
  generator, which nobody senses (it is authored, `docs/senses.md`). The server room's lamp went out and
  the cameras and exit door on the cable lost power, all read and never stored (`Perception.IsLit`,
  `Power.Powered`), so no event said so: an agent learns it only from things missing in its next view,
  and only if its caller compares views. The other rooms stayed lit because the scene lights them with
  `lit: true`, which no power reaches: a scene matter.
  Possible representation: beside `darkened`, an event on a device whose `Power.Powered` turns within a
  command (`powered_off`, `powered_on`), sensed as the `silent` row.
  Evidence (the demo, 2026-10-16): a power cut went unnoticed by every character, who went on seeing as
  before. Two causes. The scene: `lab-run.json` writes `lit: true` on dormitory, corridor, lab and
  outside (`Perception.IsLit` answers lit for it whatever the power), so only the server room, lit by
  its lamp on the generator, could go dark. The engine: no event says a room went dark.
  Proposed, two items in order:
  1. **The scene** (no engine change): `lab-run.json` lights each room by a lamp `powered_by` the
     generator's walk instead of `lit: true`, `outside` keeping `lit: true` (daylight). Its init golden
     and `docs/limits-lab.md` move with it; `HostRunTests` say whether the run still plays.
  2. **The events.** At the end of a command (after the clock and the scheduled causes, so a beat's
     `power_cut` counts), the engine compares `IsLit` of every room and `Power.Powered` of every entity
     with a `powered_by` before and after, and emits, with the command's root as cause:
     `darkened` / `lit_up` on a room whose light changed, and `powered_off` / `powered_on` on a device a
     body can sense changing (a `light_source`, a `camera`, a door or any entity with `controlled_by`);
     a cable or a generator emits nothing of its own. Sensing: `darkened` and `lit_up` are seen by every
     sighted body in the room whatever the light (the change of light is itself the thing seen, so
     `darkened` is the one event sensed in the dark by sight) and nobody elsewhere; `powered_off` and
     `powered_on` are sensed as the device's own room sees it, `silent` row, no sound.
  Test: a `power_cut` beat in `lab-run` gives each body in a powered-lamp room one `darkened` it saw,
  and from then on `location_unlit` on sight; switching the generator back gives `lit_up`; a room whose
  light did not change (another lamp still on) emits nothing; a cut that leaves every room lit emits only
  the devices' events.
  Open: `lit_up` (the light verb already owns `lit`); whether a hum stopping is heard; whether a camera
  losing power is told to its controller (it already learns from `unpowered` on its next command).
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
  (a mind swap, a possession), and the body's moves go with it. Today a body cannot join or leave a slot
  during a run (`docs/roles.md`, "Not in it"); a successor is the only hand-over, and only on destruction.
  Decided by the maintainer:
  - **Unoccupied bodies.** An agent the architect places that no player drives is unoccupied: a part of
    the scene that acts for no one until a player occupies it (an idle slot, or an agent in no slot, is
    one today).
  - **Three ways to change bodies.** (a) A player leaves its own body for an unoccupied one; the body left
    behind becomes unoccupied, and its former player or any other may occupy it again the same way.
    (b) A player drives a second body beside its own, by Possession (`docs/possession.md`) carried into
    runs: the possessor's player drives the possessed body while the possession holds. A body another
    player drives is taken only this way or by (c), and its own player stays seated, its moves for it
    refused `possessed`. (c) Two players exchange bodies, each into the other's, in one step: the mind
    swap, where both bodies are played.
  - **By ability, into a possessable body.** A character changes bodies by its own verb, which needs
    both: (1) the actor's ability, the capacity `possession` its template's parts or a modifier give
    (AGENTS.md: actions check capacities, never parts), the trigger of the Possession mechanism it is
    named after; (2) a target that cannot prevent it: the architect marks at setup which bodies may be
    possessed, and every other body refuses all three ways, as a security measure. When and into whom
    is the character's choice, within the verb's preconditions.
  - **The director gets no new lever.** It changes a body only by playing a beat the architect put in
    the run's pool (`docs/roles-levers.md`), which carries the change as an edit.
  - A move already submitted for the body goes with it to its new player, as a successor's does.
  - **Instant.** A change of body is one step: until it happens the player is in its own body, and when
    it happens the player is in the new one. No player is ever left with no body by it.
  - **Recognition follows the body, never the player.** A body left behind is still recognised as the
    character it is (its alias from its id, or its `appearance` once Identity by appearance is built), so
    others take it for that character whoever drives it. A player is not bound to a body: its own view
    is keyed by its slot, not by the slot's first body, so a change of body renames nothing it sees.
  Possible representation: a verb `transfer { target }` (into an unoccupied body, or exchanging with a
  played one), refused without the capacity, into a body not marked possessable, out of reach or sight,
  and into a body neither unoccupied nor played; `possessable` (state, bool, absent false) set by the
  scene entry; an edit kind of the same change that a pool beat may carry; possession in a run read from
  `Possession.Holder`, so the possessor's slot drives the body with no slot change and the drive ends when
  the link lapses.
  Trigger: a run scene where two players swap bodies, or one takes another's.
  Depends: Possession (shipped), for (b).
  Non-goals: a body in two slots other than by possession, senses through a possessed body.
  Test: after a transfer, the receiving handle's `submit` for the body is accepted and the former
  handle's is refused `not_a_body`; the body left behind is driven by no handle and is occupied back by a
  second transfer; after an exchange each handle drives the other's body and neither saw a step with
  none; an actor without the capacity is refused, and so is any of the three into a body not
  possessable; a possessed played body refuses its own player's move
  `possessed` and accepts the possessor's; the body's state is unchanged by any of them.
  Decided: the verb's third precondition is a condition on the target, a curse or affliction laid on
  it; reach, sight, items and who may lay one are that condition's mechanics, settled in one place in
  "Laying curses and afflictions in the world" below, not in this verb.
  Depends: also "Laying curses and afflictions in the world".
- **Laying curses and afflictions in the world.** Today both are the author's alone: `afflict` lays a
  timed modifier (`docs/verbs-edit.md`), and a curse is a link entity (`templates/curse.json`) the author
  places with `possessed_by` and `possessor` (`docs/possession.md`). Decided: the mechanics of laying one
  are settled here, once, for every rule that reads a curse or affliction as a condition (a change of
  body's third precondition first). Trigger: a character changing bodies, or any character laying a
  curse in a run. Open: whether a character lays one by a verb of its own, by a capacity, or only
  through a beat or a Scheduled outcome; what it needs (reach, sight, a carried item); how a curse or
  affliction is told apart as a condition from an attack's modifier; whether the target's
  `possessable` mark also gates being cursed.
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
  Met: `scenarios/werewolf.json` (`docs/limits-werewolf.md`) shows a beat cannot turn a body.
  Depends: Scheduled outcomes (`backlog.md`), when a character's attempt triggers it; nothing, when a beat does.
  Non-goals: changing into a template that is no agent, or merging two classes.
  Test: a human at 100 cannot lift what a cyborg at 100 can; after the beat refines the human to
  `cyborg`, it can, and its integrity and held things are as they were.
  Decided: part state the new class does not declare is refused, as `refine` refuses it; a beat's
  refused class change is recorded `beat_skipped { reason: "failed" }` and its watch goes on, as a
  refused edit's does.
  Decided: the classes a body may change into are the architect's, prepared before the story as
  templates and listed on the body's template (`becomes`); during a run only a listed change can
  happen, one of several when several are listed (`human` lists `human_with_bionic_arm` and
  `human_with_bionic_leg`, and the trigger decides which). A class is always the whole body's template,
  so a changed part is a class of its own. A class goes back only when the architect lists the way
  back.

The entries below come from the first run played by language models (2026-10-15): a separate
repository's host played `scenarios/lab-run.json` for 20 rounds, ann and bob each driven by a local
model through the `player_*` ops alone, the director pulling `alarm` at round 5 and `power_cut` at
round 12. **Evidence** says what the run showed.

- **An act names who did it.** Behaviour: an observer who sensed an act learns who did it. Today a
  command's root event sits on the target when there is one, else on the actor (`Pipeline.cs`), and
  nothing in any event names the actor; only the log line does.
  Evidence: bob watched ann search the intercom and was told `search`, about the intercom. By the same
  rule a body that is attacked learns `attack`, about itself, and not who hit it, the attacker in plain
  sight.
  Possible representation: an `actor` on the root event, stored as `entity` is, shown in a projection
  only to an observer who senses the actor by sight or touch at either end of the command; one who only
  heard keeps `from`, as today.
  Trigger: two agents in a run who should answer each other's deeds.
  Open: a field of its own or a member of `data`; whether events the root causes (`moved` under a
  `push`) carry it too; whether a command sent `via` another agent (`docs/command-via.md`) shows the
  body or the sender; whether a disguised actor is shown by the face it wears (`docs/appearance.md`).
- **A player learns the verdict on its own moves.** Today `PlayerWorld` submits, withdraws and lists
  pending moves, but nothing tells the player what became of a move once the round closes: a host reads
  `director_close_round`, whose results are the world's record (world ids, events, deltas).
  Evidence: the run's host cut those results down to `status` and `reason_code` before handing them to
  each agent; an agent holding only the player ops could not have learned that its search was
  `preempted` by bob walking away.
  Possible representation: `player_observe` also answers the player's moves of the rounds closed since
  `since_tick`, each `{ command_id, round, status, reason_code? }`, with `reason_data` filtered as
  `ActorWorld` filters a refusal.
  Open: whether `preempted` is shown as such, since it tells the player that someone else acted (the
  version side channel `docs/actor-view.md` closes); in `player_observe` or an op of its own.
- **What a thing looks like, apart from its template id.** A projection names each thing's `template`,
  so a player reads mechanics from ids.
  Evidence: the agents were shown the exit door as `jamming_door` and the corridor's camera as
  `narrow_camera`, so ann could know the door jams before she ever tried it.
  Possible representation: a template key `kind` (definition, string; "door", "camera"), inherited
  through `extends`, shown in place of `template` to everyone but the author; a template without one
  shows its id, as today.
  Trigger: a scene whose template ids give away what its characters should discover.
  Open: in place of `template` or beside it; whether `appearance` already covers bodies, leaving `kind`
  to things.
- **A glance and a close look.** Behaviour: what a character notices of others by being in the room
  is little (who or what it is, roughly); it learns more only by choosing to look closely, which is an
  act in the world.
  Today: `observe` lists every sensed entity with its facts each time it is called, the same answer
  until something changes, and `actor_inspect` gives any of them in full (props, parts with status,
  `size_cm`, `traits`, `holds`) at once, free, unseen and unlimited. A body's descriptive traits
  (`traits`: opaque tokens a scenario writes and no rule reads) reach a caller only through inspect.
  Idea (the maintainer): ann at a glance is "a human" (`kind`, the shown name, a few traits such as sex);
  looked at closely, "young, female, blonde, shorter than me".
  Possible representation:
  - **Glance** is the projection: each entity keeps its alias, shown name and the facts the mechanics
    need (location, support, status, pos), shows `kind` instead of `template`, and of its traits only the
    keys its template lists under `glance_traits` (`human`: `["sex"]`). Everything else is out of
    `observe`. `actor_inspect` is removed from the actor view, or kept but cut to the glance (open).
  - **A close look** is a verb `examine {target}`: needs sight (or touch, and then only what touch tells:
    open), one tick, emits `examined` on the target, sensed as any act (in a lit room the target and others
    see who is looking: being stared at is noticed). The command's own observation carries the target's
    detail: what inspect gives today, all traits, and the comparisons to the examiner, as codes from both
    `size_cm`: `height: taller | shorter | same` (within 5 cm), and the like for mass if wanted. Nothing is
    stored: the engine does not remember that ann was examined, the caller keeps what it was told, and a
    later `examine` answers what holds then (projections stay never-knowledge, AGENTS.md).
  - Traits stay tokens (`young`, `blonde`), never prose: "young" is the architect's word, written on the
    scene entry, not the engine's judgement.
  Trigger: an LLM-played run where repeating every detail each round floods the agents' context, or a
  scene where noticing a detail (a tattoo, a ring) is the point.
  Depends: "What a thing looks like" (`kind`). With Identity by appearance (`docs/appearance.md`), a
  disguised body's glance and close look show the face's traits, and touch sees through it.
  Non-goals: memory of what was examined; prose descriptions; partial detail by distance or light
  (a close look is all or nothing, in the first version).
  Test: ann (traits sex, age, hair) in bob's lit room: `actor_observe` for bob shows ann's `kind` and
  `sex` only, no parts, props or other traits; bob's `examine ann` takes one tick, ann's observation
  has `examined` naming bob, and bob's observation has all of ann's traits, her parts' status and
  `height: shorter`; a second `observe` still shows only the glance.
  Open: whether `examine` in the dark is allowed by touch and what it tells; whether `actor_inspect`
  goes or shrinks; whether the glance should drop unchanged entities on `since_tick` (the "same answer
  each call" half of the overload), or that is the caller's diff to make; whether part damage seen at
  a glance (a severed arm, blood) is glance-level, as it should be for a wound one cannot miss.
- **Names a character has not learned.** Behaviour: a character perceives what a thing or a body is,
  never the label the architect gave it. It knows a name only when it could: its own, one it was told,
  one written on the thing.
  Evidence (the demo): the agents saw `exit door`, a name that says what lies behind it before anyone
  opened it, and every other character by name (`ann`, human, intact, ...) on first sight, strangers
  included. Today `ActorWorld` lists each entity by its alias, `name` and `template`, and accepts a
  command naming a thing by its `name` or `aliases`. The template half is "What a thing looks like"
  (`kind`) above; this is the name half.
  Possible representation:
  - The actor view drops `name` (and `aliases`) from every entity but these: the observer itself; a thing
    whose name is written on it, `labelled` (state, bool, absent false: a door with an EXIT sign, a
    bottle's label), shown only with sight in a lit room; a body whose name the observer knows. Everything
    else is shown by its alias, `kind` and glance traits ("A glance and a close look").
  - Knowing a body's name is mechanical state on the observer: `knows_names` (state, list of ids),
    written by the scene (ann and bob are colleagues) and the author, and by a verb `introduce`: every
    body that hears the actor's speech learns the actor's name (heard voice only, so a name through the
    intercom is learned too). It is the one remembered thing, and it is state, not a projection's memory.
    A disguised body introduces itself by its own name or the face's (open).
  - Addressing: an actor names a thing by its alias, by a name it is shown, or by its `kind` when exactly
    one of that kind is in its view (else `ambiguous` with the candidates). A hidden name names nothing,
    as a disguised body's hidden name already does (`docs/appearance.md`), so probing `take exit door`
    teaches nothing.
  - An audit of the other label channels, one test each: the template id (`kind`); props that name other
    entities and say what they are for, such as the key's `opens: exit_door` or `powered_by` and
    `controlled_by`, which the actor's `inspect` must not show unless covered and sensible; `reason_data`
    (already filtered by `Addressable`); and options, whose listed verbs could tell a door is lockable or
    a thing is a door. Done when an actor-view golden over `lab-run` contains no world name, template id
    or id-bearing prop the actor was not entitled to.
  Trigger: met by the demo.
  Depends: "What a thing looks like" (`kind`), else a nameless thing shows nothing but its alias.
  Non-goals: names in another language or misheard; an observer giving a thing a name of its own (the
  caller keeps that, with the alias); the trusted ops, which keep every name.
  Test: in `lab-run`, bob's view shows the exit door as alias and `door`, not `exit door`, and `open exit
  door` names nothing; ann is shown by alias and `human` until she `introduce`s herself in bob's hearing,
  after which bob's view and commands use `ann`; a scene listing bob in ann's `knows_names` shows her
  name from the start; a `labelled` sign is read in light and not in the dark.
  Open: whether `introduce` is a verb or a `say` flag; whether a name is learned by overhearing others use
  it (no: `say` tokens are opaque, so the engine cannot tell a name was said); whether rooms keep their
  names (a character knows the corridor it stands in?) or are shown by `kind` too; whether `labelled`
  shows the whole `name` or a separate `label` token.
- **Searching in the dark.** `found` and `revealed` are sensed as the `silent` row, against the
  concealer and the thing: in an unlit room the searcher neither sees them nor feels them (touch is its
  own body and grips), so it is not told what its own search found, and a caller that reads "no `found`"
  as "nothing there" is told wrong.
  Evidence: none in the run, where every searched room was lit; found while giving the agents a "you
  found nothing hidden there" note. It becomes real as soon as "A room going dark" makes rooms go dark:
  a character searching by touch after a power cut finds the key and is told nothing.
  Proposed: the searcher senses the `found` and `revealed` of its own search by `touch`, dark or not
  (searching is groping), naming the thing and the concealer, with no `pos`; anyone else senses them as
  today. The thing is then one the searcher could grope for, so it is addressable
  (`Perception.Addressable`) and `take` reaches it by name, while the projection still does not list it
  in the dark (it is not in a grip). A search that finds nothing emits nothing, as today, and the dark is
  the reason a caller cannot read "no `found`" as "nothing there" only for others, never the searcher.
  Test: in an unlit room ann searches the bed, under which the key lies concealed: ann's observation
  has `found` naming the key by `touch`, `actor_command take key` is accepted, `actor_observe` does not
  list the key until it is in her hand; bob in the same dark room senses neither event.
  Depends: "A room going dark" item 1, for a scene where it shows.
  Open: whether a search in the dark takes longer than one in the light.
- **What `take` may lift.** `take` asks nothing of its target's kind.
  Evidence: an earlier run of the same scene took and dropped the exit door, which `lab-run.json` places
  with a `location` and `support` beside its `from` and `to`; this run offered `take` on the intercom.
  A person is lifted only when it cannot resist (`resists`), and with both hands.
  Possible representation: `take` refuses a door (`Resolve.IsDoor`) with a code of its own; a fixture is
  attached by the scene, or marked by its template.
  Open: whether a door may have a `location` at all (`SnapshotValidation`); a template mark such as
  `fixed`, or attachment only.
- **Consent to be carried.** `take` refuses an agent that can move (`resists`); only one asleep,
  unconscious or bound is lifted, so a willing one cannot be carried.
  Evidence: the ann and bob run, where bob lifted ann one-handed; the user asked that a person be
  carried only when it cooperates or cannot prevent it, and chose to build the second half first.
  Possible representation: a `yield {to}` verb setting a state prop that lets that carrier lift it
  until either moves away; or a consenting move in the same round.
  Open: which; whether a carried agent may end it by struggling, and at what cost.
  Note: the half the demo hit (a character lifting another who could resist) is shipped (`0ae6ed2`,
  `resists`). That character was after the key in the other's hand, not the body: the gap is
  "Taking from another's hand" below. This entry waits for a scene with a willing passenger.
- **Taking from another's hand.** Behaviour: a character can try to take what another holds, and the
  holder may lose it, keep it, or hand it over.
  Evidence (the demo): a character wanted the key another held; `take` is refused `held_by_another`
  (`docs/carrying.md`, `docs/limits.md`: "snatching from a hand isn't modelled"), no option offered a
  way, so it tried to carry the holder whole, which nothing then prevented.
  Proposed: a verb `snatch {target}` on an item in another agent's grip, in reach and seen or felt.
  One roll (a world with no seed refuses it `no_seed`): success when the roll is under
  `50 + (snatcher's manipulation − holder's manipulation) / 2`, clamped 5–95; a holder asleep,
  unconscious or bound loses it always, with no roll. Success moves the item into the snatcher's free
  grip (`snatched`); failure leaves it (`snatch_failed`). Both are felt by the holder, by touch, and
  seen like any act in a lit room. It refuses as `take` does for grips and weight (`hands_full`,
  `too_heavy`, ...) before rolling, and `not_held` for an item in no one's grip (a pocket is still
  `take`'s). A two-handed item held in both hands is `held_firmly`, never rolled. `held_by_another` on
  `take` gains `reason_data { holder }` (the holder, when the actor can name it), so a caller knows
  whom to ask, and `give` stays the willing way.
  Test: seeded, bob snatches the key from awake ann (equal capacities, 50%) and the two seeds that
  succeed and fail give `snatched` / `snatch_failed`, the key with bob or ann; asleep ann loses it with
  no roll and does not wake (or does: open); ann with a stunned hand (modifier) loses it more often;
  `take` on her key answers `held_by_another { holder: ann }`.
  Open: whether a failed snatch wakes, alerts or angers anyone (mechanical state only: `alert` is
  out of scope); whether it takes one tick or two; whether the holder's struggle can damage the item.
- **A CLI that stays up.** Each request is one process start and one read of the world's files.
  Evidence: the run made 236 requests at about 0.45 s each, about a fifth of its 8.5 minutes; the host's
  `snapshot` each round (0.44 s, the costliest read) was only for `run.state`.
  Possible representation: `WorldEngine.Cli serve`: one JSON request per line on stdin and one answer
  per line on stdout through the same `CliRunner.Run`, so a host keeps one process and the store's
  remembered head and registry stay warm; it takes the world's turn per request, as today. It is no
  server, so the scope line holds.
  Trigger: a host that drives runs in rounds.
  Open: a `run_state` op, or the run read through an existing op; whether the web service considered
  later replaces it or wraps it.
