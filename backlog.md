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

1. [A door that takes time to shut](#a-door-that-takes-time-to-shut).
2. [A remote command that can jam](#a-remote-command-that-can-jam).

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

### A door that takes time to shut

A door shuts within the command that shuts it, so a subject never runs for a door the AI is
closing (the roadmap's "a human and the AI act on a door in the same time window"). Simultaneous
commands stay out of scope; a scheduled cause gives the window instead, as `closes_after` does.

- **Props** (`src/engine/fields.ts`): `shut_ticks` (definition, integer, `requires` openable) and
  `closing` (state, boolean).
- **`close`** (`src/engine/verbs/openable.ts`), by hand or by its controller, of a target with a
  positive `shut_ticks`: emits `closing` (not `closed`), sets `closing: true`, withdraws any pending
  `close` and schedules one `shut_ticks` ticks on, caused by the `closing`. Nothing is moved aside
  yet: until it shuts the door is open, so `move` through it works. At the due tick the existing
  close cause (`runClose` in `src/engine/schedule.ts`) shuts it as now (moving occupants aside)
  and clears `closing`.
- **Within the window:** `open` of a closing door is allowed (`already_open` only when it is open
  and not closing): it clears `closing` and withdraws the shut, under `opened`. `close` and `lock`
  of a closing door are refused `closing`, one new code, so the AI cannot lock what it has not yet
  shut and a subject's `open` stops it. Locking a door that is open and not closing stays as today.
- **Events:** `closing` takes the row of `closed` in `EVENT_SENSES` (`docs/senses.md`).
- **Snapshot rule** (`src/engine/validate.ts`): `closing: true` on a target that is not open or has
  no pending `close` is `closing_without_close`, so the author cannot write a window by `edit`.
- **Lab:** the exit door gets `shut_ticks: 2`; step G's close by ann becomes a `closing` and the
  push aside two ticks later. A third test in `tests/scenario-lab.test.ts`, same scenario: the
  terminal unlocks and opens the exit door; it closes it, and bob, in the corridor, walks out
  through it in the window; the door shuts, and the terminal's lock is ok with bob outside. Then
  the terminal opens and closes it again, ann opens it in the window, and its `lock` is `closing`
  until it does shut.
- **Tests:** `tests/door-window.test.ts`: `closing` and the shut two ticks later, with an occupant
  moved aside only then; `move` through in the window; `open` stopping it; `close` and `lock`
  refused `closing`; a remote close the same; the rule refusing an authored `closing`; a door with
  no `shut_ticks` shutting at once as now; `closes_after` unchanged.
- **Docs:** `docs/verbs-openables.md` and `docs/schedule.md` (one line each, or a new
  `docs/door-window.md` if either passes its cap), `docs/limits-lab.md` (a door now gives way to
  a runner; what the build shows).
- **Depends on:** nothing. **Not in it:** a `closes_after` swing that takes time (its close stays
  the end of the swing), opening that takes time, a door that crushes or stops on what is in it
  (out of scope), and anything about who acted first beyond the order of commands.

### A remote command that can jam

A remote command to a door always works when its links carry it; the roadmap asks that one "must
not guarantee that the door successfully operates". The world's dice (`docs/rng.md`) give a
failure that replays exactly.

- **Prop** (`src/engine/fields.ts`): `jam_pct` (definition, integer 0 to 100, `requires`
  openable).
- **Roll** (`src/engine/verbs/openable.ts`): a command from the device's controller to a target
  with a positive `jam_pct` rolls `context.random()` once, after every precondition; under
  `jam_pct` it is jammed: status `ok`, the tick spent, one `jammed` event on the device with
  `{ verb }` and nothing else (no prop change, no shut scheduled, no occupant moved). A refusal
  cannot advance the dice (its snapshot is the input), so a jam is an `ok` with nothing done. A
  manual command never rolls; a target with no `jam_pct` never rolls, so no world without one
  changes; a world with no seed is refused `no_seed`, as any roll is.
- **Who knows:** `jammed` takes the row of `closed` in `EVENT_SENSES`; the controller's actor view
  sees it only as it sees anything, so the lab's terminal learns of a jam on the exit door by its
  camera, and a controller with none learns `ok` and nothing more.
- **Lab:** `scenarios/lab.json` takes the seeded form (`{ seed, entities }`) and the exit door
  `jam_pct: 25`; the lab tests' loader reads that form. Each existing remote step is pinned by the
  seed; any that now jams is kept by a seed that does not, or retried, and a new step finds the
  seed's first jam, `jammed` seen by the terminal through the camera, the door unchanged. A
  replay of the whole log is byte-identical (H).
- **Tests:** `tests/jam.test.ts`: with `jam_pct: 100` every remote verb is `jammed` with nothing
  changed, and with 0 none is; a hand on the same door never jams; a seeded run gives the same
  jams on replay; a world with no seed is `no_seed` for a jamming device and untouched for one
  without; the controller perceives `jammed` through a camera and not without one.
- **Docs:** `docs/power.md` one line (a device that jams) or a new `docs/jam.md` past its cap,
  `docs/senses.md` one row, `docs/limits-lab.md`.
- **Depends on:** none; after the timed shut if built after it, where a jammed `close` starts no
  window. **Not in it:** wear or a jam that persists (each command rolls afresh), jams for cameras or
  the arm, a controller told why, and repair.
