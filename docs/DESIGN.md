# Design

## Transition pipeline

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events, and return a status, deltas, and events chained by command and cause ID. Non-ok
results leave the snapshot unchanged; a success bumps its version.

The engine is pure: a transition takes a snapshot and returns a new one; I/O stays outside it.

Verbs are `move`, `take`, `drop`, `put`, `give`, `push`, `pull`, `attack`, `wait`, and `edit`. `put` and `give`
name a second address in `args.destination`; `put` also takes `args.relation`: `on` or `in`. A
surface declares `surface`, sized by its footprint; a container declares `container` and
`inner_*_cm`. `put` emits one `moved` and sets `support` or `contained_in`, never a position:
position comes through the chain. Fit compares the two longest dimensions; a container's contents
do not count.
Carrying is declared: `take` and `give` need `manipulation` scaled by the item's `hands_required`,
or `mouth_carry` within the carrier's `carry_limit_g` — one item at a time, never a two-handed one.
`attack` picks the first mode its attacker can use, with damage from its template. `lock`,
`unlock`, and `put` into a container need `manipulation`; opening, closing, and `put` on do not.

`take` lifts a thing out of whatever holds it; only an agent holds, and what it carries moves rooms
with it. Agency is the template's `agent` property, withheld from detached parts. A shut container
hides its chain: `take` and `put` refuse `container_closed`; sight inside is `false`.

`open`, `close`, `lock`, and `unlock` change one property of a target that declares `openable` as a
`props` delta under the matching event. `open` refuses a locked target with `locked`; `lock` and
`unlock` need a carried entity whose `opens` is the target's id, or refuse `no_key`.

## State model

A snapshot contains entities, a tick, a version, a sequence number, template hash, and coverage.
Entities refer to room locations, support surfaces, and containers by ID. Position is stored for
entities supported by a room and derived through the support or containment chain otherwise.
`validateSnapshot` checks that one pure way: no support or containment loop, `pos` exactly when the
support is a room, `location` the room at the end of the chain, every reference present (a detached
entity's origin is history, not a link), detached parts accounted for, integrity in 0–100, and ids
below `next_seq`. A world that breaks one does not open; the CLI reports `invalid_snapshot` and the rule.

Templates declare parts, dimensions, mass, properties, break products, and residue. Only declared
parts exist. Part state records integrity and whether a part is intact, damaged, detached, or
destroyed. Detachable subtrees become entities and retain their origin in `detached_from`.

Capacities sum part contributions and unexpired modifiers, clamped to 0–100; templates with no
parts have none. Residue records amounts on their receiver. Support loss emits displacement and
fall events; high falls break entities, spawn products, and move liquids and solids to the landing
surface.

## The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)`, `openWorld(dir)`, and
`memoryWorld(snapshot)` return a `World` with `command(cmd, { basedOn })`, `edit(op, { command_id,
basedOn })`, `query(q)`, `snapshot()`, and `entity(id)`. An edit runs one `spawn`, `remove`, `place`,
`set_props`, or `set_part` as a logged command by the reserved non-agent author `world`, and is
refused when the result would break a snapshot invariant; removing a support or container passes
its riders and contents into the relation it itself was in. A store-backed world reads through to
its directory on every call, so two handles see each other's commands; a memory world holds its
own. A missing directory, a changed template hash, or a broken snapshot is a `WorldError` with a
code.

## Commands and persistence

The CLI is a JSON adapter over `World` with no logic of its own: it reads one request on stdin, calls
one method, and writes the response. Zod validates that boundary, and a failure becomes
`{status:"invalid", issues}`. `world init` builds a world from a list of template spawn
specifications; responses carry statuses, deltas, and events, with a snapshot only when requested.

Each world stores `initial.json`, canonical `snapshot.json`, and a JSONL command log holding every
command. The store appends before atomically replacing the snapshot; an accepted command whose
result breaks a snapshot invariant is logged as `invalid` and never written. Replay folds accepted
commands over the initial snapshot; a template-hash mismatch is an error, stale ones re-evaluated.

## Queries and coverage

Queries answer facts and perception from the snapshot, templates, events, and coverage. Covered
relations and properties answer true or false from state; a category absent from coverage answers
unknown. Perception supports sight, hearing, and smell — the last only where a world's coverage
declares it — from capacities, lighting, doors, and loud event types; sight answers `false` with
basis `enclosed` inside a shut container, hearing and smell do not. Coverage describes what the
engine can answer, never what any actor knows, notices, or remembers.
