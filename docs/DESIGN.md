# Design

## Transition pipeline

Commands pass through target resolution, preconditions, a verb transition, physical consequences,
and causal events, returning a status, deltas, and events chained by command and cause ID; a non-ok
result leaves the snapshot and version unchanged, I/O stays outside, a transition returns a new one.

`put` and `give` name a second address in `args.destination`; `put` also takes `args.relation`: `on` or
`in`. A surface declares `surface`, sized by its footprint; a container declares `container` and
`inner_*_cm`. `put` emits one `moved` and sets `support` or `contained_in`, never a position, which
comes through the chain. Fit compares the longest dimensions; a container's contents do not count.
Carrying is declared: `take` and `give` need `manipulation` scaled by the item's `hands_required`,
or `mouth_carry` within the carrier's `carry_limit_g` — one item at a time, never a two-handed one.
`attack` picks the first mode its attacker can use, with damage from its template. `lock`, `unlock`,
and `put` into a container need `manipulation`; opening, closing, and `put` on do not.
`take` lifts a thing out of whatever holds it; only an agent holds, and what it carries moves rooms
with it. Agency is the template's `agent` property, withheld from detached parts. A shut container
hides its chain: `take` and `put` refuse `container_closed`; sight inside is `false`.
`open`, `close`, `lock`, and `unlock` change one property of a target that declares `openable` as a
`props` delta under the matching event. `open` refuses a locked target with `locked`; `lock` and
`unlock` need a carried entity whose `opens` is the target's id, or refuse `no_key`. `verbs()` is the
catalog each verb describes itself to.

## State model

A snapshot holds entities, a tick, a version, a sequence number, a template hash, and coverage;
entities refer to rooms, supports, and containers by ID. Position is stored for room-supported
entities and derived through the chain otherwise.
`validateSnapshot` checks that one pure way: no support or containment loop, `pos` exactly when the
support is a room, `location` the room at the end of the chain, every reference present (a detached
entity's origin is history, not a link), detached parts accounted for, integrity in 0–100, and ids
below `next_seq`. A world that breaks one does not open; the CLI reports `invalid_snapshot` and the
rule. Templates declare parts, dimensions, mass, properties, break products, and residue, and only
declared parts exist: part state records integrity and whether a part is intact, damaged, detached,
or destroyed. Detachable subtrees become entities and retain their origin in `detached_from`.
Capacities sum part contributions and unexpired modifiers, clamped to 0–100; templates with no parts
have none, and residue records amounts on its receiver. Support loss emits displacement and fall
events; high falls break entities, spawn products, and move liquids and solids to the landing
surface.

## The library API

`src/api.ts` is the whole public surface: `createWorld(dir, scenario)`, `openWorld(dir)`, and
`memoryWorld(snapshot)` return a `World` with `command`, `edit`, `check`, `since`, `trace`, `beat`,
`upgradeTemplates`, `query`, `snapshot`, `entity`, and `id`. `check` agrees with `command` without
writing or logging; `since` gives the deltas and events of every ok command after a version; `beat`
runs commands in array order against one shared base, one log line each, each with its status.
Refusals carry optional `reason_data` (reach, fit, enclosure, capacity numbers, never prose).
`trace` follows `cause_id` root-first from an event, or from the last delta of an entity field, else
its spawn; an initial entity's field has an empty chain, and a memory world answers
`history_unavailable` for what predates it. Edits (`spawn`, `remove`, `place`, `set_props`,
`set_part`) are logged under the author `world`, refused when they break an invariant. Store worlds
share a directory, memory worlds hold their own; a missing directory, changed hash, or bad version
is a `WorldError`. A scenario entry may declare `"id"`, and `location`, `support`, `contained_in`,
`detached_from.entity`, and the props `from`, `to`, and `opens` may name their entity. Names resolve
to `e<n>` in entry order before the first spawn; an empty, duplicate, id-shaped, or unknown name is
refused before anything is written. `World.id(name)` returns the id: `openWorld` reads the map back
from `ids.json`, `memoryWorld` takes it as an option.

## Commands and persistence

The CLI is a JSON adapter over `World`: one request on stdin, one method, one response. Zod
validates that boundary, a failure becomes `{status:"invalid", issues}`; `init` takes spawn specs.
Each world stores `initial.json`, canonical `snapshot.json`, `templates.json`, `ids.json` when the
scenario named anything, a JSONL log of every command, a JSONL event store queries read instead of
replaying, and `head.json` written last, so opening a world detects a crash without reading the log.
A world loads the set it was created with, so editing `templates/` reaches new worlds only;
`upgradeTemplates` moves a live one and refuses if a template lost a field an entity uses, or if the
log no longer replays to the stored snapshot. An accepted command whose result breaks an invariant is
logged `invalid` and never written. Replay folds accepted commands over the initial snapshot; a hash
mismatch is an error, stale commands are re-evaluated.

## Queries and coverage

Queries answer facts and perception from snapshot, templates, events, and coverage; an uncovered
category answers unknown, and coverage describes the engine's answers, never who knows or remembers.
Perception spans sight, hearing, and smell (smell only where covered) via capacities, lighting,
doors, and loud events; an event-form perceive is true at either end of its command. Sight alone is
`false` (`enclosed`) in a shut container; `perceivers: true` names who sensed each event.
