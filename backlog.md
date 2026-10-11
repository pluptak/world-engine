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

1. [A link of a power walk may be switched off](#a-link-of-a-power-walk-may-be-switched-off).
2. [Switching a link on and off: `switch_on`, `switch_off`](#switching-a-link-on-and-off-switch_on-switch_off).
3. [Electric light: a powered lamp lights its room](#electric-light-a-powered-lamp-lights-its-room).
4. [The lab's power cut cuts power](#the-labs-power-cut-cuts-power).

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
  ordered batch.
- A gate or door that crushes what is in its way (a prop turning it on, the damage deciding whether the thing
  is destroyed or stops the closure): postponed in favour of pushing aside.
- Migrating stored worlds between `schema_version`s: an older world is refused, never read as if it matched
  (AGENTS.md: no silent migration); a tool comes when a world must be kept.
- Raised and set aside until a scenario needs them: several parents per event (`causes: [...]`) and a stored
  `root_id`; stepping onto shards having a consequence; an agent slipping through a gap, and a head sized apart
  from the body for bites; a wound from a detachment written by `edit`.
- The limits in `docs/limits*.md`: none is worth a verb yet, except as listed in `plans/candidates.md`.

## Items

_None: every item is shipped. Only the maintainer adds one, under Priorities._

### A link of a power walk may be switched off

Power fails today only by destruction (`docs/power.md`): nothing switches a source off, so a
generator cannot fail. `plans/power.md` decided one state prop on any link.

- **The prop** (`src/engine/fields.ts`): `on`, state, boolean. Absent means on, so no stored world
  and no template changes.
- **The walk** (`powered()` and `cutOf` in `src/engine/power.ts`): power stops at the first link
  that is destroyed or has `on: false`, the entity itself and the source included. `unpowered`'s
  `cut` names that link, as it names a destroyed one now; `disconnected` stays for a destroyed link
  on the control walk only. An agent with a `powered_by` that is off, or whose walk is, is refused
  `unpowered` and senses nothing (`agentFault`, `query.ts`), as when its cable is cut. A camera on
  a switched-off walk feeds nothing.
- **Beats need nothing new:** `update_props { on: false }` on a generator is a power cut, and
  `{ on: true }` restores it.
- **Tests:** `tests/remote.test.ts` (or a new `tests/power-switch.test.ts`): a generator off leaves
  a door's remote `unlock` refused `unpowered` with `cut` the generator, and its key still turns it
  by hand; a cable off cuts what lies beyond it and nothing before it; `on: true` restores; a
  terminal powered by the generator is refused `unpowered` and senses `false` / `unpowered`; a beat
  `update_props { on: false }` on the generator cuts power at its tick, and its follower
  restores it.
- **Docs:** `docs/power.md` (the prop and the walk; "nothing switches a source off" goes),
  `docs/fields.md` if it lists state props.
- **Depends on:** nothing. **Not in it:** verbs that switch (next item), light.

### Switching a link on and off: `switch_on`, `switch_off`

The prop of the item above, set by an agent at the device or through its controller
(`plans/power.md`).

- **Verbs** (`src/engine/verbs/`, a new `switch.ts`, or beside `openable.ts`): `switch_on` and
  `switch_off` on a target that is a `power_source` or has a `powered_by`, else refused
  `not_switchable`; `already_on` / `already_off`. Each needs reach and `manipulation` (declared on
  the verb, as `lock` does), takes one tick, and emits `switched { on }` on the target, sensed as
  `opened` is (a row in `EVENT_SENSES`, `docs/senses.md`).
- **Remote:** a target with a controller is worked by its controller or at its panel exactly as
  `open` is in `openable.ts` (`remote`, `remoteFault`, `panelFor`): reach and hands skipped, the
  control walk's `disconnected` / `unpowered` refusals. Reuse those functions; do not copy them.
  An agent may switch off the walk that powers itself; it then cannot switch it back.
- **Round move:** both are round moves (`isRoundMove`).
- **Registration:** one line or entry each in `verbs/index.ts`, `src/errors.ts`, `src/contract.ts`,
  the verb table of `tests/property-gen.ts`, the `docs/verbs.md` index; the rules in
  `docs/verbs-openables.md` (or the family file that suits devices).
- **Tests:** `tests/switch.test.ts`: a human at the generator switches it off and on, each refusal
  once; out of reach and handless are refused; the event is seen in a lit room and not from the
  next room; the AI switches a cable off through the panel and its own camera goes dark; a switch
  on a target with no power link is `not_switchable`; `options` offers `switch_off` to someone at
  a running generator.
- **Depends on:** the item above. **Not in it:** a switch an agent wears, timers on a switch.

### Electric light: a powered lamp lights its room

`isLit` (`src/engine/query.ts`) counts a room's own `lit` and a burning flame; nothing electric
lights a room, so a power cut cannot darken one (`plans/power.md`).

- **The rule** (`isLit`): a `light_source` with a `powered_by` lights its room while it is
  `powered()` and not destroyed or shut in a container, as a flame does while burning. `burning`
  stays a flame's prop; a room's own `lit` stays the architect's and is untouched by power.
- **Template:** a new `templates/lamp.json` (a `light_source`, no fuel, no `burning`), with
  `powered_by` written by the architect. The templates hash moves, as any new template does.
- **Tests:** `tests/light.test.ts`: a lamp on a running generator lights an unlit room, and sight of
  a stone there is true; the generator off (`on: false`, the first item) darkens it and sight is
  `false` / `location_unlit`; on again lights it; a lamp switched off itself darkens the room; a
  lamp with no `powered_by` lights nothing; a lit room's own `lit` ignores power.
- **Docs:** `docs/perception.md` (what lights a room), `docs/power.md` (lamps), `docs/templates.md`
  if it lists templates.
- **Depends on:** the first item. **Not in it:** a lamp's light reaching other rooms, dimness,
  a `darkened` event (open in `plans/power.md`).

### The lab's power cut cuts power

The lab run's pool beat `power_cut` sets the server room's `lit: false` by hand, and a limit says a
generator cannot fail (`docs/limits-lab.md`, "As a run").

- **Scene** (`scenarios/lab-run.json`): the server room loses its own `lit` and gains a lamp on the
  generator; `power_cut` becomes `update_props { on: false }` on the generator. `scenarios/lab.json`
  stays as it is.
- **Tests:** `tests/acceptance-lab-run.test.ts` row 6: after the cut the server room is dark
  (`isLit` false, a subject there sees `false` / `location_unlit`), and the AI, whose terminal runs
  on the generator, is refused `unpowered` with `cut` the generator for any move; the other rows
  pass unchanged, which they must, since the room is lit until the cut.
- **Docs:** `docs/limits-lab.md` (the generator line goes; what the run still cannot say stays),
  `docs/scenario.md` only if it describes the pool.
- **Depends on:** the three items above. **Not in it:** restoring power in the lab, a
  `darkened` event.
