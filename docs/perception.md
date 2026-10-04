# Queries, perception and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage, as
`"true"`, `"false"`, or `"unknown"` with a `basis_code`. Covered relations and properties answer
true or false from state; a category absent from coverage answers unknown. Coverage describes what
the engine can answer, never what any actor knows, notices, or remembers.

Perception spans sight, hearing, and smell — smell only where coverage declares it — and reads
capacities, room lighting, doors, and loud event types. Sight is `false` (`enclosed`) for anything
inside a shut container; hearing and smell ignore it, and cross a doorway for loud events. A door is
perceived from either room it joins.

An event-form perceive reads the world at both ends of the command that produced the event and is
true if it is true at either: an observer sees someone leave for a dark room as well as arrive, and
closing a chest afterwards does not unsee what was put in it. The entity form reads the present.

A command or edit with `perceivers: true` names, per event and by sense, every agent that could
have sensed it under the same either-end rule, plus the senses coverage leaves unknown.
