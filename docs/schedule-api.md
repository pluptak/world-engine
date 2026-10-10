# Reading the schedule

`World.schedule(filter?)` answers what the world will do by itself, in run order: the causes of
`snapshot.schedule` ([schedule.md](schedule.md)) that match the filter, as stored. Each is a copy the
caller may keep or change without touching the world. A filter is `{ kind?, entity?, until_tick? }`: a
`kind` of `close`, `bleed`, `process` or `beat`, an `entity` id, and `until_tick`, which keeps the causes
due at or before that tick. Nothing is logged and no version moves; an empty list means nothing matches.
A store world and a memory world answer alike, so a `fork` lists what its parent does.

The CLI has it as the `schedule` op: `{ "op": "schedule", "world": dir, "filter": {...} }` answers
`{ "schedule": [...] }`, with `filter` optional. Its response uses `ScheduledCauseSchema` in
`src/contract.ts`, the same shape as a stored snapshot's list.

**Only beats are named.** An author's beat carries the `id` its author gave it, so the author can name
it. The engine's own causes (a door's close, a bleed, a process) are read but never named: no caller
can retime or cancel one, since what the engine decided is not a caller's to move.

**Not in an actor's view.** `actorWorld` and the `actor_*` ops have no read of the schedule: what the
world will do is not something an actor knows ([actor-view.md](actor-view.md)).

**Not in it.** An id for the engine's causes, and any write. Changing a pending beat is an edit
([beats.md](beats.md)), never a read.

Tests: `tests/schedule-api.test.ts`. The lab's step G reads its pending beats this way.
