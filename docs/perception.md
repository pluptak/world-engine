# Queries, perception and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage, as `"true"`,
`"false"`, or `"unknown"` with a `basis_code`. Two lists decide what can be asked.
`ENGINE_CAPABILITIES` is what the engine computes: seven relations and four senses, while properties
are open (`integrity`, `residue` and `pos` are computed, any other name is read from props).
Coverage is what this world models, chosen among them: `validateSnapshot` refuses a covered relation
or sense the engine has no rule for (`coverage_not_computable`). A category the world leaves out of
coverage answers unknown (`uncovered_category`, `uncovered_sense`), and a sense the engine cannot
compute answers unknown / `engine_incapable`. Coverage is never what any actor knows or notices.
`reachable` (subject an agent, object a target) answers by `inReach`, the one rule every verb that
reaches applies: same room, centre to centre within `reach_cm`, bars or not; it is `false` /
`no_object` without an object. It stays arm's reach for a door: `open`, `close`, `lock` and
`unlock` also work a doorway with no position from anywhere in either room it joins, and a door of
the next room from its far side (`reachedAsDoor` in `src/engine/verbs/address.ts`), so a door can
read `reachable: false` while `options` has `open` ready. `push`, `pull`, `attack`, `take` and
`search` refuse that same door `out_of_reach`, which is what `reachable` answers for; what can be
worked is `options`' answer. A `fact` subject may name one part, `<entity>.<part>`: `status`,
`integrity` and `attached_to` (its entity) read the stored entry or the template default and write
nothing; any other field is `false` / `not_a_part_field`, and a part the template does not declare
is `false` / `no_such_part`.

Sight needs light. A room is lit when its `lit` prop is true, or when something located in it has
`light_source: true` and `burning: true` (`isLit` in `src/engine/query.ts`): on the floor, on a
table, in a hand or a pocket, but not shut in a closed container and not once destroyed. Nothing
stores the answer, so a lantern that is lit, carried out, or burnt out changes it at once; seeing
across an open door still needs both rooms lit (`adjacent_open_door_lit`), and an unlit room is
`location_unlit`. `light` and `douse` set `burning` ([verbs-other.md](verbs-other.md)).

The sense table lives in [senses.md](senses.md): one row per event class, with a touch column
that ignores rooms — touch reads the observer's own body and grips (`own_body`), never an
authored event, and anything else is `not_touching`.

An event-form perceive reads the world at both ends of the command that produced it and is true if
it is true at either; `perceivers: true` names, per event and by sense, every agent that could have
sensed it. A destroyed observer senses nothing, `false` / `observer_destroyed`, so `observe` lists
nothing for it and `inspect` is `null`; its own end it still sensed, from the moment before.

What an agent can name in a command is a perception question too (`addressable`): itself, its room,
what it senses now by a covered sight, smell or touch, or what it could grope for, in reach,
neither hidden nor shut in a closed container (a door from either room it joins, wherever in the room, even if
it stands in the other one). Anything else,
by name, alias, id or `<entity>.<part>`, is `unresolved` as if it did not exist, so no candidate or
refusal names it; the world author names anything. Ids are sequential, so a hidden thing stays
unnamed by id too until what hides it moves. A dog that smells wine in a shut chest names it.
