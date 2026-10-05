# Queries, perception and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage, as
`"true"`, `"false"`, or `"unknown"` with a `basis_code`. Covered relations and properties answer
true or false from state; a category absent from coverage answers unknown. Coverage describes what
the engine can answer, never what any actor knows, notices, or remembers.

Perception spans sight, hearing, and smell — smell only where coverage declares it — and reads
capacities, room lighting, doors, and loud event types. Sight is `false` (`enclosed`) for anything
inside a shut container, and `false` (`concealed`) for anything hidden under or behind something,
by every observer; hearing and smell ignore both, and cross a doorway for loud events. A door is
perceived from either room it joins. An abstract entity is `false` (`abstract`) in either form: it
exists and is not a thing to be sensed. The bases, then, are `no_such_entity`, `no_such_event`,
`no_target`, `no_sense_capacity`, `uncovered_sense`, `abstract`, `concealed`, `enclosed`,
`not_perceptible`, `location_unlit`, `same_location`, `same_location_lit`,
`adjacent_open_door_lit`, `adjacent_loud_event` and `unsupported_sense`.

A `found` event is where the search happened, not what was under it, so it is read against the
concealer: whoever can see where it was looked for can see that it was found there.

An event-form perceive reads the world at both ends of the command that produced the event and is
true if it is true at either: an observer sees someone leave for a dark room as well as arrive, and
closing a chest afterwards does not unsee what was put in it. The entity form reads the present.

A command or edit with `perceivers: true` names, per event and by sense, every agent that could
have sensed it under the same either-end rule, plus the senses coverage leaves unknown.
