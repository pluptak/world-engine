# Relation tests

The tests that pin each row of [relations.md](relations.md), by its T label.

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
T8 `holders.test.ts` "each in_part rule fires on a snapshot wrong in exactly that way", "hands_full
on a third item" and "hand loss drops its grip only".
T9 `remote.test.ts` "a link must name something, and neither walk may loop".
