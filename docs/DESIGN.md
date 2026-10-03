# Design

## Transition pipeline

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events. The pipeline returns a status, deltas, and events. Refused, unresolved,
ambiguous, and invalid commands leave the snapshot unchanged. Successful commands increment its
version. Events use command IDs and cause IDs to preserve the causal chain.

The engine is pure: transitions take a snapshot and return a new one. Persistence and command-line
input/output are handled outside the engine.

Verbs are `move`, `take`, `drop`, `put`, `give`, `push`, `pull`, `attack`, and `wait`. `put` and `give`
name their second address in `args.destination`, beside `args.relation` for `put`, which is `on` or
`in`: a surface declares `surface` and is sized by its footprint, a container declares `container` and
`inner_*_cm`. `put` emits one `moved` event and sets `support`, or `contained_in`; it never sets a
position, so an item on a surface takes that surface's position through the support chain. Fit
compares the item's longest dimensions with the destination's longest — width and depth for a
surface, all three for a container — because nothing fixes an orientation; the contents a container
already holds are not counted. `give` emits `moved` with `from` and `to` and changes one
`contained_in`; the recipient must have capacities of its own and hold the item's required
manipulation. Consent is the consumer's decision; the engine only checks the transfer is possible.

`take` lifts a thing out of whatever holds it: only an agent holds, so a container or a piece of
furniture keeps what is inside it and that can be taken out. Agency is declared by the template's
`agent` property and withheld from anything detached from what it was part of, so a severed arm is
neither an actor of a command nor a recipient of one. A shut container hides its whole chain of
contents: `take` and `put` refuse `container_closed`, and sight of anything inside answers `false`
with basis `enclosed`.

`open`, `close`, `lock`, and `unlock` change one property of a target that declares `openable`: `open`
or `locked`, recorded as a `props` delta under an `opened`, `closed`, `locked`, or `unlocked` event.
`open` refuses a locked target with `locked`; `lock` and `unlock` need a carried entity whose `opens`
property is the target's id, or refuse `no_key`. A door joins two rooms instead of sitting in one, so
it is in view from either room it joins and, having no position of its own, is in reach from both.

## State model

A snapshot contains entities, a tick, a version, a sequence number, template hash, and coverage.
Entities refer to room locations, support surfaces, and containers by ID. Position is stored for
entities supported by a room and derived through the support or containment chain otherwise.

Templates declare parts, dimensions, mass, properties, break products, and residue. Only declared
parts exist. Part state records integrity and whether a part is intact, damaged, detached, or
destroyed. Detachable subtrees become entities and retain their origin in `detached_from`.

Capacities sum contributions from available parts and apply unexpired modifiers, clamped to 0–100.
Templates with no parts have no capacities. Residue records material amounts on the entity that
received them. Physical support loss emits displacement and fall events; sufficiently high falls
break entities, spawn products, and transfer liquids and solids to the landing surface.

## Commands and persistence

The CLI accepts one JSON request on stdin: a command, query, or snapshot request. Command responses
contain statuses, deltas, and events; snapshots are included only when requested. Zod validates
the JSON boundary. `world init` creates a world from a list of template spawn specifications.

Each world stores `initial.json`, canonical `snapshot.json`, and a JSONL command log. The store
appends each accepted or rejected command before atomically replacing the current snapshot.
Replay folds accepted commands over the initial snapshot. A template-hash mismatch on load is an
error; stale commands are re-evaluated against the current snapshot.

## Queries and coverage

Queries answer facts and perception using the snapshot, templates, events, and coverage. Covered
relations and properties answer true or false from state. A category absent from coverage answers
unknown. Perception supports sight and hearing using capacities, room lighting, doors, and loud
event types. Sight answers `false` with basis `enclosed` for anything inside a shut container; hearing
does not.

Coverage describes what the engine can answer; it does not describe what any actor knows, notices,
or remembers. The engine models world state only.
