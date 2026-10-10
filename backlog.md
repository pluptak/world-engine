# Backlog

One item = one small block: plan it, build it, `npm run check`, review the diff, commit. Each item
keeps every invariant in AGENTS.md (determinism, pure core, `canonicalJson`, no prose,
coverage-governed `"unknown"`). Delete an item in the same commit that ships it — git history
records it; `docs/` describes what is built (index: `docs/DESIGN.md`).
Measurements and test results live in `docs/measurements.md`, not here; an item quotes a number only
when the item is about that number.

**Scope line.** The engine is a library: a typed, in-process API through which a caller manipulates
objects, humans and animals and asks about the world. The CLI is one thin adapter over that API, and
there is no web server. Turning prose or intent into calls, and choosing calls that reach a desired
world state, is the job of a middleware that does not exist and is not part of this project. Items
below may make the API easier for such a caller to drive (describing its own commands, dry-running
one, structured refusals), but never interpret text or plan on a caller's behalf.

## Priorities

Work top to bottom; take the first entry that is not blocked. Reorder here, nowhere else.

1. [Every pending cause has a ref, and the schedule is read through the API](#every-pending-cause-has-a-ref-and-the-schedule-is-read-through-the-api).
2. [The author postpones, holds, releases and cancels a pending cause](#the-author-postpones-holds-releases-and-cancels-a-pending-cause).
3. [`advance` stops before a cause](#advance-stops-before-a-cause).

When nothing above is unblocked, stop and report. Gaps with no plan yet are in
[plans/candidates.md](plans/candidates.md); they are not work, and only the maintainer promotes one
to an item here.

## How the work runs

One item at a time on `main`. Sessions that run in parallel each work in their own git worktree and
commit only their own files. Additions to the shared registration points (`src/engine/verbs/index.ts`,
`src/errors.ts`, `src/contract.ts`, the verb table in `tests/property-gen.ts`, the `docs/verbs.md`
index, `CLAUDE.md`) are one line or one entry each, so parallel work conflicts at most trivially.

## Out of scope

- Prose or intent → calls, and planning calls toward a goal state: the middleware's job.
- Named coarse levels (`empty`/`half`/`full`, `fresh`/`stub`): the middleware translates them into the
  percentage and condition forms (`docs/forms.md`), unless several callers need them or they hold an
  invariant.
- A web/HTTP server: the API is in-process; the CLI is the only adapter.
- Any Story-writer integration: a decision for that repo, if a middleware ever exists.
- The social resolver (mechanical state only: `alert`, `locked_by_order`), a generic relation graph,
  and continuous physics (Rapier/Box2D): revisit only when a concrete world needs them.
- More than single-parent `extends`: several parents, trait bundles, categories nothing reads, and
  see-through barriers (`docs/templates.md`).
- `move` suggesting where to stand: a free spot within reach of each thing is a position chosen to reach
  something, which is planning; `suggest` lists ids, never positions.
- A `distance` query: facts are true, false or unknown, and positions are in every observation.
- The verbs `turn` (it needs a facing direction), `use` (too general), `throw` (it would deal impact damage
  to agents) and `bandage` (a bleed stops by its count).
- Pathfinding: a caller routes around a barrier in several moves. Agents acting in parallel: a `beat` is an
  ordered batch, and two commands never share a tick.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

Every item is ready now and names anything it leans on; the order is under Priorities.

### Every pending cause has a ref, and the schedule is read through the API

Everything the world will do by itself is one list, `snapshot.schedule` (`docs/schedule.md`), but
a cause has no name: a door's close is "the `close` on e7", and only a beat has an id, the
author's own. A caller that wants to read what comes next digs through `snapshot()`, and nothing
can point at one pending cause to act on it (the next item).

- **Ref** (`src/model.ts` `ScheduledCause`, `src/engine/pending.ts`): every cause gets `ref`, `c<n>`
  from a counter of its own on the snapshot (`next_cause`, absent until the first cause), so no
  entity or event id moves; the builder confirms no existing expected id shifts. `withCause`
  allocates it, the one place a cause is added. A run that schedules the next (a bleed, a
  process's reconcile, a beat's follower) makes a new cause with a new ref; a repeating beat keeps
  its ref across runs, as it keeps its id, since it is one pending beat. A beat's `id` stays the
  author's token beside it.
- **Snapshot rules** (`src/engine/validate.ts`): a missing or malformed ref, a ref used twice, or
  a ref at or above `next_cause` is `invalid_cause_ref`. Stored worlds become `schema_version` 6
  (an older one is refused, as AGENTS.md has it).
- **Read** (`src/api.ts`): `World.schedule(filter?)`, `filter` `{ kind?, entity?, until_tick? }`,
  returns the pending causes in run order as stored (`ref`, `kind`, `entity`, `due_tick`,
  `cause_id`, and the kind's own fields). The CLI gets a `schedule` op (`src/cli/main.ts`, its
  request and response in `src/contract.ts` and `RESPONSES`). `actorWorld` gets nothing and the
  `actor_*` ops none: what the world will do is not something an actor knows.
- **Tests:** `tests/schedule-api.test.ts`: a door's `open` lists its close with a ref, `close` by
  hand takes it off; a bleed's next run and a process's next run have new refs; a repeating
  beat's ref is the same on every run; the filter by kind, entity and `until_tick`; the CLI op
  answers the same; a store world reopened lists the same refs; a duplicated or missing ref is
  refused by `validateSnapshot`. `tests/schedule.test.ts` holds the contract's stored shape in step
  as now. The property test's every step stays valid.
- **Lab:** step G (`tests/scenario-lab.test.ts`) reads the exit door's pending shut through
  `World.schedule({ entity: exit_door })` instead of the snapshot, if it reads it at all.
- **Docs:** new `docs/schedule-api.md` (refs and the read; its `docs/DESIGN.md` line);
  `docs/schedule.md` one line on `ref`; `docs/api.md` the method; `CLAUDE.md` `schema_version` 6.
- **Depends on:** nothing. **Not in it:** writes (next item), an actor's view of the schedule.

### The author postpones, holds, releases and cancels a pending cause

The schedule decides when the door shuts; a story needs to say "not yet". Today only a beat can be
withdrawn (`cancel_beat`), and nothing can be delayed or held. These are the author's, as every
edit is now; which role may use them is settled with the roles.

- **Edits** (`src/engine/verbs/edit.ts`), each naming a cause by `ref`:
  - `postpone { ref, ticks }` (`ticks` a positive int): the cause falls due `ticks` later, ordered
    after what is already due at that tick, as if scheduled now. A held cause is `cause_held`.
  - `hold { ref }`: the cause keeps `ticks_left` (its due tick minus the clock) in place of
    `due_tick`, and the clock passes it by. Held twice is `cause_held`.
  - `release { ref, at_tick? }`: due at the clock plus `ticks_left`, or at `at_tick`, which must
    be ahead (`beat_in_past`). Not held is `cause_not_held`.
  - `cancel { ref }`: off the schedule, a beat's followers with it, as `cancel_beat` does, which
    stays as it is.
  - A ref nothing pending carries is `no_such_cause`; a postpone past the largest safe integer is
    `clock_overflow`. The new codes are declared on `edit` and registered as AGENTS.md says.
- **The record** is the edit's own root event, as for `cancel_beat`: no new event type, nobody
  senses it, `since` and `attempts` show it.
- **What a hold means for each kind:** a held cause is still pending, so a process is not
  scheduled twice by `reconcile`, and a reconcile that finds the process can no longer run
  withdraws it, held or not; a held cause whose entity goes is pruned like any other; a held
  close leaves the door as it is (a `shut_ticks` door stays `closing`, so `lock` stays refused
  `closing` and `open` still withdraws the shut).
- **Snapshot rules:** a held cause has a positive integer `ticks_left` and no `due_tick`, and held
  causes are listed after every due one, in the order they were held (`invalid_cause_hold`,
  `schedule_unordered`). `World.schedule` shows them with `due_tick: null` and `held: true`.
- **Tests:** `tests/schedule-edit.test.ts`, a small world: a self-closing door's close postponed
  closes later and not at its old tick; held, it never closes however long the clock runs;
  released, it closes `ticks_left` later, or at `at_tick`; cancelled, never; a held process and a
  held bleed the same; a held beat's subject removed prunes it; every refusal code once; `check`
  of a postpone writes nothing. The property generator issues the four edits on refs it reads
  from the schedule, and every step stays valid.
- **Lab:** a new step in `tests/scenario-lab.test.ts`: the terminal closes the exit door, the
  author holds its shut, ann walks through the open door in more ticks than `shut_ticks`, the
  author releases it and it shuts behind her. `docs/limits-lab.md` G gains: the door's timing is
  the author's to stretch, never a subject's.
- **Docs:** `docs/schedule-api.md` (the four edits), `docs/verbs-other.md` one line under the
  edit, `docs/schedule.md` one line on held causes.
- **Depends on:** the ref item above. **Not in it:** a subject or a thing blocking a cause (a
  wedge: world state the cause reads when it runs, a later lab item), creating a cause other than
  a beat, an event of its own for each edit.

### `advance` stops before a cause

A caller pacing the world to a story wants time to run up to a moment and stop there, so it can
let that moment happen, delay it or drop it. `advance` stops on what an agent senses
(`stop_on_perceived`), never on what is about to run.

- **Arg** (`advanceVerb` in `src/engine/verbs/wait.ts`, `src/engine/clock.ts`): `stop_before`, a
  ref, optional. The advance ends at the tick before the cause falls due, everything due before it
  run, the cause still pending; `ticks` stays the upper bound, and `stop_on_perceived` may end it
  sooner. The `advance` event's `advanced` says how many ticks passed, as now.
- **Edge cases:** a ref nothing pending carries is `no_such_cause`; a held cause, or one due at
  the very next tick, leaves nothing to run up to and is refused `cause_not_ahead`, taking no time.
  A cause withdrawn or postponed by what runs during the advance no longer stops it, and the
  advance runs on to `ticks` or to the cause's new tick, whichever comes first.
- **Tests:** in `tests/schedule-api.test.ts`: an advance of 10 before a close due in 4 ends after
  3 ticks with the close pending, and a second advance of 1 runs it; a close withdrawn by an
  earlier cause in the span (a beat that edits the door shut) lets the advance run its full
  ticks; `stop_on_perceived` earlier than the cause wins; both refusals. Two advances that end
  where one would have leave the same world, as the time property already holds.
- **Lab:** the step of the hold item starts with an advance stopped before the exit door's shut,
  so the author decides at the last tick.
- **Docs:** `docs/verbs-other.md` (`advance`), `docs/time.md` one line beside waking early,
  `docs/schedule-api.md`.
- **Depends on:** the ref item (and the hold item for its lab step). **Not in it:** stopping on a
  kind or an entity rather than one ref, a `wait` that stops before a cause (an actor does not
  know the schedule).
