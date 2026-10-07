# Actor view: one actor's side of a world

A `World` answers its trusted caller everything: the snapshot, every delta and event, who sensed
what. A character's controller must learn only what its character could, so it is handed the view
instead (`actorWorld(world, actor)`, `src/actor-world.ts`): `observe`, `inspect`, `options`
([api.md](api.md)), `check` and `command`, all as that actor. An unknown actor is `no_such_entity`.

A command's actor is the view's own and `perceivers`, the world's record of who sensed each event,
is never sent. A result is the verdict and `observation` alone, with no `snapshot`, `deltas` or
`events`. A `reason_data` value naming an entity the actor could not name itself (`addressable`
in [perception.md](perception.md): its view, or what it could grope for) is left out: in the dark,
`blocked` by an unseen chest names no chest, and `carried` still names the holder. What the view
names is held to that rule by the property test.

The CLI has the same five as ops, each with `world` and `actor`: `actor_observe` (`since?`),
`actor_inspect` (`entity`), `actor_options` (`refused?`), `actor_check` (`command`) and
`actor_command` (`command`, `based_on_version?`). Their `command` is `command_id`, `verb`,
`target?` and `args?` only: one that names an `actor` or `perceivers` is `invalid` with
`unrecognized_keys`. `actor_command` answers `status`, `command_id`, `resolved_target`,
`candidates?`, `reason_code?`, `reason_data?` and `observation`. A runtime allowed only these five
ops learns no more than the actor could.
