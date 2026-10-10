# Actor view: one actor's side of a world

A `World` answers its trusted caller everything: the snapshot, every delta and event, who sensed
what. A character's controller must learn only what its character could, so it is handed the view
instead (`actorWorld(world, actor)`, `src/actor-world.ts`): `observe`, `inspect`, `options`
([api.md](api.md)), `check` and `command`, all as that actor. An unknown actor is `no_such_entity`.

A command's actor is the view's own and `perceivers`, the world's record of who sensed each event,
is never sent. A result is the verdict and `observation` alone, with no `snapshot`, `deltas` or
`events`. A `reason_data` value naming an entity the actor could not name itself (`addressable` in
[perception.md](perception.md): its view, or what it could grope for) is left out: in the dark,
`blocked` by an unseen chest names no chest, and `carried` still names the holder. Nor does a
refusal give an amount: `available` and `held` are left out ([liquids.md](liquids.md)). What the
view names is held to that rule by the property test.

Nothing it sends carries the world's `version`, which counts every accepted command and so would
tell the actor that others acted out of its sight. A projection carries the `tick` instead, time the
actor feels pass, and `observe({ since_tick })` is what it sensed at that tick or later: the events
at the tick of its last look come again, and a controller keeps them apart by `event_id`. `options`
has no `version`, and `command` takes no `basedOn`: it is decided against the world as it is, so an
actor is never `preempted`.

Nor does it send a world id: entity and event ids come from one counter, and a gap in them would
show that something was made out of sight. Each actor is sent its own alias of every id instead,
`aliasOf(actor, id)`: `x` and 12 hex digits of a hash of the two, a part address keeping its part,
so two actors' names for one thing differ and none carries a count. A projection lists entities in
alias order. A target or an argument that is one of the actor's aliases is read back to its id on
the way in; another actor's alias, and a raw world id, names nothing: the view passes the first
`nothing<n>` no name, alias or id of the world is. A `token` arg (what `say` says) is passed as
written, never read back. The hash hides the count from a controller that
reads its views, not from one that hashes candidate ids to decode them; a key would close that.

The CLI has the same five as ops, each with `world` and `actor`: `actor_observe` (`since_tick?`),
`actor_inspect` (`entity`), `actor_options` (`refused?`), `actor_check` (`command`) and
`actor_command` (`command`); a `since` or `based_on_version` is `invalid`, `unrecognized_keys`.
Their `command` is `command_id`, `verb`, `target?` and `args?` only: one that names an `actor` or
`perceivers` is `invalid` with `unrecognized_keys`. `actor_command` answers `status`, `command_id`,
`resolved_target`, `candidates?`, `reason_code?`, `reason_data?` and `observation`. A runtime
allowed only these five ops learns no more than the actor could.
