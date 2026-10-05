# Relations

Every relation a snapshot holds and the rule that holds it there. A live link needs its target
present, history does not, and a key's `opens` may dangle. `any` means the target exists.

| relation | points at | exclusive with | loop | live | target removed | target detached | R | T |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `support` | any | `contained_in` | no | yes | riders released | severed part lands | R1 | T1 |
| `contained_in` | any | `support` | no | yes | contents released | carrier drops it | R1 | T2 |
| `location` | a room | — | no | derived | refused | follows the chain | R2 | T3 |
| `detached_from` | entity, part | — | not walked | no | kept | is the record | R3 | T4 |
| `props.from`/`to` | a room | — | no | yes | refused | — | R4 | T5 |
| `props.opens` | openable entity | — | no | yes | kept | — | R5 | T6 |
| `concealed_by` | any, in the room | — | no | yes | uncovers | unchanged | R6 | T7 |

R1 — `validateSnapshot`: `support_and_contained_in`, `support_or_containment_cycle`,
`dangling_reference`; a room support also needs a `pos`, and `put` refuses a loop.
R2 — `validateSnapshot`: `location_mismatch`; `remove` refuses `occupied_room`.
R3 — never walked: `detached_from` is history and may name a removed origin; the rule on the part
that left is `detached_part_without_entity`.
R4 — `validateSnapshot`, for the `door` template only: `door_side_not_room`, else
`dangling_reference`.
R5 — `validateSnapshot`: `opens_target_not_openable`; a name reaching nothing is left alone.
R6 — `validateSnapshot`: `concealed_by_abstract` (neither end a mark), `concealed_by_not_same_room`,
`concealed_by_cycle`, `dangling_reference`. Moving either end clears it under a `revealed` event.

T0 `validate.test.ts` "each rule fires on a snapshot wrong in exactly one way".
T1 T0; `edit.test.ts` "removing the table under the bottle produces the break chain caused by the
edit"; `scenario-hand.test.ts` "detaching a chair leg creates a supported part entity".
T2 `put.test.ts` "an item put into a container is contained with no support or position";
`scenario-hand.test.ts` "a holder who loses all manipulation drops carried items".
T3 T0; `edit.test.ts` "edits that break snapshot invariants are refused and change nothing".
T4 `edit.test.ts` "a detached part outlives its origin, but not the other way round".
T5 `validate.test.ts` "a wrong kind on a door side or on a key's opens is refused; a door's rooms
cannot go", and "a door to a removed room names the dangling prop".
T6 `validate.test.ts` "removing a chest leaves the key that opened it valid"; T5's first test too.
T7 `validate.test.ts` "a concealer shares the room, and neither end may be a mark";
`conceal.test.ts` "an abstract entity can neither conceal nor be concealed".

Every rule above is a code `edit` refuses with; the property tests aim an edit at each of them.
