# Design

## Transition pipeline

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events. The pipeline returns a status, deltas, and events. Refused, unresolved,
ambiguous, and invalid commands leave the snapshot unchanged. Successful commands increment its
version. Events use command IDs and cause IDs to preserve the causal chain.

The engine is pure: transitions take a snapshot and return a new one. Persistence and adapter I/O
are outside it.

Verbs are `move`, `take`, `drop`, `put`, `give`, `push`, `pull`, `attack`, and `wait`. `put` and `give`
name a second address in `args.destination`, and `put` also takes `args.relation`, `on` or `in`. A
surface declares `surface` and is sized by its footprint; a container declares `container` and
`inner_*_cm`. `put` emits one `moved` and sets `support`, or `contained_in`, never a position: an item
takes its surface's position through the chain. Fit compares the item's longest dimensions with the
destination's longest, as nothing fixes an orientation, and counts nothing of what a container holds.
`give` emits `moved` with `from` and `to`, changes one `contained_in`, and needs a recipient with
capacities and the item's manipulation; consent is the consumer's decision.

`take` lifts a thing out of whatever holds it: only an agent holds, so a container keeps what is inside
and that can be taken out. Agency is declared by a template's `agent` property and withheld from
anything detached, so a severed arm is neither an actor nor a recipient. A shut container hides its
whole chain: `take` and `put` refuse `container_closed`, and sight of anything inside is `false`.

`open`, `close`, `lock`, and `unlock` change one property of a target that declares `openable` — `open`
or `locked` — as a `props` delta under an `opened`, `closed`, `locked`, or `unlocked` event. `open`
refuses a locked target with `locked`; `lock` and `unlock` need a carried entity whose `opens` is the
target's id, or refuse `no_key`. A door joins two rooms, so it is in view and in reach from either.

## State model

A snapshot contains entities, a tick, a version, a sequence number, template hash, and coverage.
Entities refer to room locations, support surfaces, and containers by ID. Position is stored for
entities supported by a room and derived through the support or containment chain otherwise.
`validateSnapshot` checks that one pure way: no support or containment loop, `pos` exactly when the
support is a room, a detached part accounted for by an entity that carries it, integrity in 0–100, and
ids below `next_seq`. A world that breaks one does not open; the CLI reports `invalid_snapshot` and
the rule.

Templates declare parts, dimensions, mass, properties, break products, and residue. Only declared
parts exist. Part state records integrity and whether a part is intact, damaged, detached, or
destroyed. Detachable subtrees become entities and retain their origin in `detached_from`.

Capacities sum contributions from available parts and apply unexpired modifiers, clamped to 0–100.
Templates with no parts have no capacities. Residue records material amounts on the entity that
received them. Physical support loss emits displacement and fall events; high falls break entities,
spawn products, and transfer liquids and solids to the landing surface.

## The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)`, `openWorld(dir)`, and
`memoryWorld(snapshot)` return a `World` with `command(cmd, { basedOn })`, `edit(op, { command_id,
basedOn })`, `query(q)`, `snapshot()`, and `entity(id)`. An edit runs one `spawn`, `remove`, `place`,
`set_props`, or `set_part` as a logged command by the reserved non-agent author `world`, and is
refused when the result would break a snapshot invariant. A store-backed world reads through to its
directory on every call, so two handles see each other's commands; a memory world holds its own. A
missing directory, a changed template hash, or a broken snapshot is a `WorldError` with a code.

## Commands and persistence

The CLI is a JSON adapter over `World` with no logic of its own: it reads one request on stdin, calls
one method, and writes the response. Zod validates that boundary, and a failure becomes
`{status:"invalid", issues}` naming the code and any rule the snapshot broke. `world init` builds a
world from a list of template spawn specifications; responses carry statuses, deltas, and events, with
a snapshot only when requested.

Each world stores `initial.json`, canonical `snapshot.json`, and a JSONL command log holding every
command. The store appends before atomically replacing the snapshot; replay folds accepted commands
over the initial snapshot. A template-hash mismatch on load is an error; stale commands are re-evaluated.

## Queries and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage. Covered
relations and properties answer true or false from state; a category absent from coverage answers
unknown. Perception supports sight and hearing using capacities, room lighting, doors, and loud event
types; sight answers `false` with basis `enclosed` for anything inside a shut container, hearing does
not. Coverage describes what the engine can answer, never what any actor knows, notices, or remembers.
The engine models world state only.
