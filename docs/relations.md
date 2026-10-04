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

R1 — `validateSnapshot`: `support_and_contained_in`, `support_or_containment_cycle`,
`dangling_reference`; the verb that sets the relation asks whether it is a surface, a container, or
a carrier, and refuses a loop as `circular_placement`.
R2 — `validateSnapshot`: `location_mismatch`; it is the room at the end of the chain, so it is
derived — never a loop, never a second place. `remove` refuses `occupied_room`.
R3 — never walked: `detached_from` is history, and its origin may be gone. The rule on the other
side of the same event is `detached_part_without_entity`.
R4 — `validateSnapshot`, for the `door` template only: `door_side_not_room` when a side names
something that is not a room, `dangling_reference` when it names nothing.
R5 — `validateSnapshot`, on any entity: `opens_target_not_openable` when `opens` names something
that cannot be opened. A name that reaches nothing is left alone: a key outlives its lock.

T0 `validate.test.ts` "each rule fires on a snapshot wrong in exactly one way".
T1 T0; `edit.test.ts` "removing the table under the bottle produces the break chain caused by the
edit"; `scenario-hand.test.ts` "detaching a chair leg creates a supported part entity".
T2 `put.test.ts` "an item put into a container is contained with no support or position";
`edit.test.ts` "removing a held container passes its contents to the holder";
`scenario-hand.test.ts` "a holder who loses all manipulation drops carried items".
T3 T0; `edit.test.ts` "edits that break snapshot invariants are refused and change nothing".
T4 `edit.test.ts` "a detached part outlives its origin, but not the other way round".
T5 `validate.test.ts` "a door side names a room and a key's opens names something openable",
"a door to a removed room names the dangling prop", and "a wrong kind on a door side or on a key's
opens is refused; a door's rooms cannot go".
T6 `validate.test.ts` "removing a chest leaves the key that opened it valid"; T5's first test too.

Every rule above is a code `edit` refuses with; the property tests aim an edit at each of them.
