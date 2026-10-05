# Queries, perception and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage, as
`"true"`, `"false"`, or `"unknown"` with a `basis_code`. A category absent from coverage answers
unknown. Coverage describes what the engine can answer, never what any actor knows or notices.

The sense table lives in [senses.md](senses.md): one row per event class, with a touch column
that ignores rooms — touch reads the observer's own body and grips (`own_body`), never an
authored event, and anything else is `not_touching`.

An event-form perceive reads the world at both ends of the command that produced it and is true if
it is true at either; `perceivers: true` names, per event and by sense, every agent that could have
sensed it.
