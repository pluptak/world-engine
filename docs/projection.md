# Projection: what one observer could sense

`world.observe(observer, { since? })` answers, in one structure, what `perceive` would answer for
that observer across the whole world: never knowledge, never prose, and never more than the
queries it is made of. The CLI's `observe` op takes `observer` and an optional `since`. An
unknown observer is `no_such_entity`.

`entities` lists, in id order, every entity the observer senses now by `sight`, `smell` or
`touch`, with the senses that reach it. A thing makes no sound by being there, so hearing is
reported for events only: the entity form of hearing answers for everything in the room, a hidden
note included, and a projection must not list what the observer cannot tell is there. Senses the
coverage does not declare are named in `unknown_senses` and never consulted.

An entity seen or felt carries `facts`; one only smelt does not. A fact is present when coverage
declares it: `location`, `support`, `contained_in` (with `in_part` beside it) and `status` from
`relations`, `integrity`, `residue` and `pos` from `properties`, `pos` being the derived one. A
reference names another listed entity, the observer's own room, or is `null` for none; a reference
to anything else is left out, so a stone seen through a door into a lit room has no `location`.

`events`, given `since`, lists every event after that version the observer sensed, with its
`event_id`, `tick`, `type` and the senses, each read through event-form `perceive`, true before or
after its command. It names the `entity` when the observer saw, smelt or felt the event. One only
heard names nobody and says `from` instead: `here` for a sound in the observer's own room,
`next_door` for a loud one through a doorway. A voice in the dark, a footstep, a knock on a door the
observer cannot see tell where they came from and not what made them; the controller knows who spoke
because it issued the command. `Result.events`, `since`, `trace` and `perceivers` stay the
omniscient record and name every entity. A push in a lit room is seen and heard; lifting a ring from
a pocket in the dark is not sensed at all. A store world and a memory world project byte for byte
alike.

`world.inspect(observer, entity)` is one listed entity in more detail, or `null` when the observer
senses nothing of it: the same senses and facts, `reachable` where coverage declares it, and with
sight or touch the props whose names coverage declares as properties (`open`, `locked`, ...) and
`holds`, the listed entities on it or in it. The CLI's `inspect` op takes `observer` and `entity`.
`command(c, { observe: true })` attaches `observation`, the actor's projection after the command
with `since` the version it was applied to: its own events as the actor sensed them, none if it
was refused. The CLI's `command` op takes `observe` alike.

One actor's side of a world, with no access to the rest, is [actor-view.md](actor-view.md).
