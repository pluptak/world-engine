# Senses

One row per class of event, one column per sense and situation: `s`, `h`, `m` and `t` are sight,
hearing, smell and touch, `A` the same room, `+` an open door and `B` a shut door. `T` is true,
`L` is true only if the event is loud (`broken`, `detached`, or a `dropped` of 50 cm or more) and
`F` is false. Touch ignores rooms: `O` is felt when the observer is the subject or holds it in a
grip, and not felt otherwise; a `collided` is felt through what it hit as well.

| row | sA | s+ | sB | hA | h+ | hB | mA | m+ | mB | t |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `authored` | F | F | F | F | F | F | F | F | F | F |
| `pour` | T | T | F | T | L | L | T | F | F | O |
| `broken` | T | T | F | T | L | L | T | L | L | O |
| `event` | T | T | F | T | L | L | F | F | F | O |
| `silent` | T | T | F | F | F | F | F | F | F | O |
| `entity-odorous` | T | T | F | T | F | F | T | F | F | O |
| `entity-odourless` | T | T | F | T | F | F | F | F | F | O |

`authored` is `edit`, `advance`, `placed`, `edited`, `removed`, and a `spawned` whose cause is one of those:
the world author's own work, which nobody senses, though its consequences (`displaced`, `dropped`,
`broken`, a product's `spawned`) are sensed as any other event. `pour` is `pour`, `poured` and
`spilled`; `broken` is a break whose entity held a liquid or residue; `event` is any other. The
`entity-` rows are the entity form, where there is no event and so nothing is loud. `found` is read
against the concealer it names, `revealed` against the thing revealed. `silent` is `changed` (a template's process moving a prop, [processes.md](processes.md)), `light`, `douse`,
`lit` and `doused`, the hand acts
(`take`, `give`, `put`, `search`, `found`, `revealed`), `wait`, `capability_changed`, and a `moved`
whose cause chain starts at `take`, `give` or `put`; its hearing is `quiet`. A `moved` under `move`,
`push` or `pull` is footsteps or scraping, and stays `event`. The false bases are `no_such_entity`,
`no_such_event`, `no_target`, `observer_destroyed`, `no_sense_capacity`, `authored`, `odourless`,
`quiet`, `not_touching`, `abstract`, `concealed`, `enclosed`, `not_perceptible` and
`location_unlit`; the unknown ones are `uncovered_sense` and `engine_incapable`; the true ones are
`same_location`, `same_location_lit`, `adjacent_open_door_lit`, `adjacent_loud_event` and
`own_body`.