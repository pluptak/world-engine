# Design

These docs describe behaviour and name the .NET code and tests that hold it. The measurements and
the limits files' scripts are the TypeScript engine's, kept at the git tag `ts-final`.

What is built, nothing aspirational, one concept per file:

- [thesis.md](thesis.md): what the engine promises, and the decisions that bound it.
- [overview.md](overview.md): the problem, who it is for, one worked example, scale and non-goals.
- [pipeline.md](pipeline.md): the transition pipeline.
- [verbs.md](verbs.md): the index of verbs, one line each, and the rules every verb shares.
- [verbs-moving.md](verbs-moving.md): `move`, `push`, `pull`.
- [verbs-holding.md](verbs-holding.md): `take`, `drop`, `put`, `give`, `pour`, `consume`.
- [verbs-openables.md](verbs-openables.md): `open`, `close`, `lock`, `unlock`.
- [verbs-power.md](verbs-power.md): `switch_on`, `switch_off`.
- [verbs-combat.md](verbs-combat.md): `attack`.
- [verbs-sensing.md](verbs-sensing.md): `search`, `light`, `douse`, `say`.
- [verbs-time.md](verbs-time.md): `wait`, `advance`.
- [verbs-edit.md](verbs-edit.md): `edit`.
- [state.md](state.md): snapshots, validation, templates, parts, capacities, physical consequences.
- [structure.md](structure.md): parts, sparse part state, what writes it, and severing.
- [templates.md](templates.md), [fields.md](fields.md): templates, upgrades; each prop's tier.
- [relations.md](relations.md): every relation, and the rule that holds it.
- [relation-tests.md](relation-tests.md): the tests that pin each relation's rule.
- [carrying.md](carrying.md): holding parts, grips and pockets, and what losing a part drops.
- [api.md](api.md): the public surface and its self-describing schema.
- [api-options.md](api-options.md): reads that change nothing: check, options, since, attempts.
- [api-writes.md](api-writes.md): edits, names, anchors, and the prototype guard.
- [fork.md](fork.md): a fork is a memory world from a snapshot, sharing nothing.
- [space.md](space.md): anchors, offsets and the derived `near` relation.
- [scenery.md](scenery.md): what is seen but no verb reaches.
- [provenance.md](provenance.md): what `cause_id` records, how `trace` walks it, and its limits.
- [schedule.md](schedule.md): the causes the world runs by itself, by kind, and how they run.
- [schedule-api.md](schedule-api.md): reading that schedule through `Scheduled`, filtered.
- [scenario.md](scenario.md): a scene: the entities, the seed, the beats queued at creation and the
  run's limits.
- [run.md](run.md): a run made from a scene: registering, running, ended, and the limit and the
  slots that end it.
- [restart.md](restart.md): a run played again from its own world.
- [roles.md](roles.md): the author, director and player roles.
- [roles-levers.md](roles-levers.md): the pool, the odds, idling, and closing quiet rounds.
- [rounds.md](rounds.md): a round: every move decided against one world, in an order no caller
  picks, one tick.
- [host.md](host.md): a reference host that plays a run through the JSON ops, dropping late answers.
- [processes.md](processes.md): declaring a prop that changes by itself, and reconciling it.
- [processes-then.md](processes-then.md): what the run that reaches the bound does.
- [processes-runs.md](processes-runs.md): first runs, reads, stored shape, rate, and chance.
- [processes-shipped.md](processes-shipped.md): the lantern, the candle, and hungry bodies.
- [beats.md](beats.md): authoring a scheduled intervention; its order, storage, and tests.
- [beats-actions.md](beats-actions.md): what runs at the due tick: actions, conditions, failure.
- [beats-chains.md](beats-chains.md): followers after a run, and repeats.
- [beats-watch.md](beats-watch.md): a beat's `all` condition and watches, which keep watch until
  their action has run.
- [measurements.md](measurements.md): what a read costs as the log grows.
- [measurements-commands.md](measurements-commands.md): what a command costs as the world grows.
- [measurements-writers.md](measurements-writers.md): what writers' turns cost.
- [speech.md](speech.md): saying an opaque token at a volume, and who hears it.
- [rng.md](rng.md): the world's dice, a seed in the snapshot, so chance replays exactly.
- [bleeding.md](bleeding.md): a severed part's wound, bleeding by itself until its count runs out.
- [verbs-surgery.md](verbs-surgery.md): `cut`, opening a part without severing it.
- [time.md](time.md): the clock, what each verb takes, and what falls due as it advances.
- [walking.md](walking.md): where an agent may walk: room bounds, barriers, and the destination.
- [occupancy.md](occupancy.md): footprints, what stops a push, and where a fall lands.
- [persistence.md](persistence.md): the CLI adapter and the world directory.
- [persistence-derived.md](persistence-derived.md): checkpoints and deltas, derived from the log.
- [persistence-verify.md](persistence-verify.md): verifying a world, and upgrading its templates.
- [locking.md](locking.md): writers' turns.
- [locking-crash.md](locking-crash.md): a stale lock taken over, and a dead writer's leftovers
  swept.
- [perception.md](perception.md): queries, perception, and coverage.
- [senses.md](senses.md): the sense table both queries and tests read.
- [senses-bases.md](senses-bases.md): the basis codes a perception answers with.
- [projection.md](projection.md), [actor-view.md](actor-view.md): observation; one actor's side.
- [projection-inspect.md](projection-inspect.md): one entity in detail; a command's observation.
- [command-via.md](command-via.md): the agent that sent an actor's command (`via`).
- [possession.md](possession.md): a curse makes a body act only at its possessor's word.
- [sockets.md](sockets.md): filling a severed part again, by its own limb or an implant.
- [liquids.md](liquids.md): liquid in props, and the `pour` verb.
- [forms.md](forms.md): the architect's percentages and conditions in a scenario, and
  `capacity_cm3`.
- [catalog.md](catalog.md): the presets an architect may place, with their forms and defaults.
- [refine.md](refine.md): the `refine` edit, an entity becoming a more specific preset.
- [limits.md](limits.md): what the inn scenario could not express.
- [limits-workshop.md](limits-workshop.md): what occupancy, impact and landing cannot express.
- [limits-camp.md](limits-camp.md): what light, processes and eating cannot express.
- [limits-watch.md](limits-watch.md), [limits-actor.md](limits-actor.md): the watch, outside and in,
  and the cell, in.
- [power.md](power.md): `powered_by`, `controlled_by`, and openables run by a controller.
- [door-window.md](door-window.md): a door with `shut_ticks` is closing for a while before it shuts.
- [intercom.md](intercom.md): a device that carries its room's sound to its controller, and the
  controller's speech into the room.
- [integrity.md](integrity.md): a template with no parts may declare `max_integrity`, the most it
  can take.
- [jam.md](jam.md): a device with `jam_pct` may jam the remote command its controller sends.
- [manipulator.md](manipulator.md): an arm with a gripper, run by a controller over its control
  walk.
- [camera.md](camera.md): a camera's sight, lent to the agent its feed reaches, within its cone.
- [panel.md](panel.md): a panel a subject at it works a device through, as its controller does.
- [limits-lab.md](limits-lab.md): the underground lab, with today's mechanics.
