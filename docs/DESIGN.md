# Design

## Transition pipeline

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events. The pipeline returns a status, deltas, and events. Refused, unresolved,
ambiguous, and invalid commands leave the snapshot unchanged. Successful commands increment its
version. Events use command IDs and cause IDs to preserve the causal chain.

The engine is pure: transitions take a snapshot and return a new one. Persistence and command-line
input/output are handled outside the engine.

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
event types.

Coverage describes what the engine can answer; it does not describe what any actor knows, notices,
or remembers. The engine models world state only.
