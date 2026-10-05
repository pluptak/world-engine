# Queries, perception and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage, as
`"true"`, `"false"`, or `"unknown"` with a `basis_code`. A category absent from coverage answers
unknown. Coverage describes what the engine can answer, never what any actor knows or notices.

## The sense table

One row per class of event, one column per sense and situation: `s`, `h` and `m` are sight, hearing
and smell, `A` the same room, `+` an open door and `B` a shut door. `T` is true, `L` is true only if
the event is loud (`broken`, `detached`, or a `dropped` of 50 cm or more) and `F` is false. Sight's
`T` means the observer's room is lit, and through an open door that both are lit; else `F` is
`location_unlit`, and a shut door is `not_perceptible`. A door stands in no room of its own, so it
is perceived from either one it joins. A shut door is no door to hearing and smell, which cross a
doorway only on a loud event. An entity is smelled when it holds a liquid or carries residue, and
hearing one in the same room is `T`: it is within earshot of it.

| row | sA | s+ | sB | hA | h+ | hB | mA | m+ | mB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `authored` | F | F | F | F | F | F | F | F | F |
| `pour` | T | T | F | T | L | L | T | F | F |
| `broken` | T | T | F | T | L | L | T | L | L |
| `event` | T | T | F | T | L | L | F | F | F |
| `entity-odorous` | T | T | F | T | F | F | T | F | F |
| `entity-odourless` | T | T | F | T | F | F | F | F | F |

`authored` is `edit`, `placed`, `edited`, `removed`, and a `spawned` whose cause is one of those:
the world author's own work, which nobody senses, though its consequences (`displaced`, `dropped`,
`broken`, a product's `spawned`) are sensed as any other event. `pour` is `pour` and `poured`, and
`broken` is a break whose entity held a liquid or residue; `event` is every other event. The
`entity-` rows are the entity form, where there is no event and so nothing is loud. `found` is read
against the concealer it names, `revealed` against the thing revealed. The false bases are
`no_such_entity`, `no_such_event`, `no_target`, `no_sense_capacity`, `uncovered_sense`, `authored`,
`odourless`, `abstract`, `concealed`, `enclosed`, `not_perceptible`, `location_unlit`, and
`unsupported_sense`; the true ones are `same_location`, `same_location_lit`,
`adjacent_open_door_lit` and `adjacent_loud_event`.

An event-form perceive reads the world at both ends of the command that produced it and is true if
it is true at either; `perceivers: true` names, per event and by sense, every agent that could have
sensed it.
