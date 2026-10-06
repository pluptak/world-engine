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
`no_object` without an object. A `fact` subject may name one part, `<entity>.<part>`: `status`,
`integrity` and `attached_to` (its entity) read the stored entry or the template default and write
nothing; any other field is `false` / `not_a_part_field`, and a part the template does not declare
is `false` / `no_such_part`.

The sense table lives in [senses.md](senses.md): one row per event class, with a touch column
that ignores rooms — touch reads the observer's own body and grips (`own_body`), never an
authored event, and anything else is `not_touching`.

An event-form perceive reads the world at both ends of the command that produced it and is true if
it is true at either; `perceivers: true` names, per event and by sense, every agent that could have
sensed it. A destroyed observer senses nothing, `false` / `observer_destroyed`, so `observe` lists
nothing for it and `inspect` is `null`; its own end it still sensed, from the moment before.
