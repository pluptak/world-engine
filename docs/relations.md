# Relations

Every relation a snapshot holds and the rule that holds it there. A live link needs its target
present, history does not, and a key's `opens` may dangle. `any` means the target exists.

| relation | points at | exclusive with | loop | live | target removed | target detached | R | T |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `support` | any | `contained_in` | no | yes | riders released | severed part lands | R1 | T1 |
| `contained_in` | any | `support` | no | yes | contents released | carrier drops it | R1 | T2 |
| `in_part` | a holding part | — | no | yes | re-seated | drops with it | R7 | T8 |
| `location` | a room | — | no | derived | refused | follows the chain | R2 | T3 |
| `detached_from` | entity, part | — | not walked | no | kept | is the record | R3 | T4 |
| `props.from`/`to` | a room | — | no | yes | refused | — | R4 | T5 |
| `props.opens` | openable entity | — | no | yes | kept | — | R5 | T6 |
| `concealed_by` | any, in the room | — | no | yes | uncovers | unchanged | R6 | T7 |
| `props.powered_by` | any | — | no | yes | refused | — | R8 | T9 |
| `props.controlled_by` | any | — | no | yes | refused | — | R8 | T9 |

R1 — `validateSnapshot`: `support_and_contained_in`, `support_or_containment_cycle`,
`dangling_reference`; a room support also needs a `pos`, and `put` refuses a loop. What sits in a
container that declares `inner_*_cm` fits them (`container_contents_too_large`, as `put` refuses `too_large`).
R2 — `validateSnapshot`: `location_mismatch`; `remove` refuses `occupied_room`.
R3 — never a link: `detached_from` is history and may name a removed origin; the rule on the part
that left is `detached_part_without_entity`, accounted for back along `detached_from`.
R4 — `validateSnapshot` on an entity with a string `from` or `to`:
`door_side_not_room`, else `dangling_reference`.
R5 — `validateSnapshot`: `opens_target_not_openable`; a name reaching nothing is left alone.
R6 — `validateSnapshot`: `concealed_by_abstract` (neither end a mark),
`concealed_by_not_same_room`, `concealed_by_cycle`, `dangling_reference`. Moving either end clears
it under a `revealed` event.
R7 — `validateSnapshot`: `in_part_holder_mismatch` (set exactly when the holder declares holding
parts), `in_part_unknown_part`, `in_part_unavailable`, `grip_occupied`, `part_contents_too_large`.
A removed holder passes the item on as R1 does; it keeps its part only if the new holder declares
it, else takes a free grip ([carrying.md](carrying.md)).
R8 — `validateSnapshot`: `dangling_reference`, `power_loop`, `control_loop`; a destroyed link
stays and breaks the walk ([power.md](power.md)).

T0–T9 name the tests that pin each row: [relation-tests.md](relation-tests.md). Every rule above
is a code `edit` refuses with; the property tests aim an edit at each of them.
