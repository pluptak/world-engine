# Transition pipeline and verbs

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events, and return a status, deltas, and events chained by command and cause ID. Non-ok
results leave the snapshot unchanged; a success bumps its version. The engine is pure: a transition
takes a snapshot and returns a new one; I/O stays outside.

Verbs are `move`, `take`, `drop`, `put`, `give`, `push`, `pull`, `attack`, `open`, `close`, `lock`,
`unlock`, `wait`, and `edit`. Each declares its args, the capacities it needs and the refusal codes
it can return; `verbs()` is the catalog read from those declarations, and a refusal with an
undeclared code is an engine bug that throws.

`put` and `give` name a second address in `args.destination`; `put` also takes `args.relation`: `on`
or `in`. A surface declares `surface`, sized by its footprint; a container declares `container` and
`inner_*_cm`. `put` emits one `moved` and sets `support` or `contained_in`, never a position, which
comes through the chain. Fit compares the longest dimensions; a container's contents do not count.

Carrying is declared: `take` and `give` need `manipulation` scaled by the item's `hands_required`,
or `mouth_carry` within the carrier's `carry_limit_g` — one item at a time, never a two-handed one.
`attack` picks the first mode its attacker can use (fist, bite), with damage from its template.
`lock`, `unlock`, and `put` into a container need `manipulation`; opening, closing, and `put` on
do not. A carrier drops what it held when a structural loss takes away the capacity holding it.

`take` lifts a thing out of whatever holds it; only an agent holds, and what it carries moves rooms
with it. Agency is the template's `agent` property, withheld from detached parts. A shut container
hides its chain: `take` and `put` refuse `container_closed`; sight inside is `false`.

`open`, `close`, `lock`, and `unlock` change one property of a target that declares `openable` as a
`props` delta under the matching event. `open` refuses a locked target with `locked`; `lock` and
`unlock` need a carried entity whose `opens` is the target's id, or refuse `no_key`. A door joins
two rooms through its `from` and `to` props and is in reach and in view from either.
