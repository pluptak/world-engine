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

1. [An intercom](#an-intercom).
2. [The lab's acceptance table](#the-labs-acceptance-table).

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

### An intercom

The AI can say nothing to the subjects and hears only its own room: a camera carries no sound
(`docs/limits-lab.md`, C), and the terminal stands in the server room. An intercom is the hearing
counterpart of a camera: a device that carries its room's sounds to the agent it feeds, and that
agent's speech out into its room.

- **Prop and template:** `intercom` (definition, boolean) in `src/engine/fields.ts`;
  `templates/intercom.json`: small (20×10×20), 1 kg, not an agent, `intercom: true`.
- **The feed:** as a camera's (`docs/camera.md`): an intercom feeds `controller(intercom)` while it
  is not destroyed and `remoteFault` is null. `feeds` in `src/engine/power.ts` takes the prop to
  look for (`camera` or `intercom`), its callers passing `camera`.
- **Listening** (`perceive` in `src/engine/query.ts`, after the body's own answer and the camera
  loop): for `hearing`, when the body's answer is false, each intercom feeding the observer is
  tried as if the observer stood at the intercom: its own room only, the hearing row's same-room
  rule (`always`, or `volume` with `heardAtVolume` measured from the intercom), so a whisper is
  heard only within `NEAR_THRESHOLD_CM` of it and a hand act stays `quiet`. True is `intercom`.
  Never next door, never smell, sight or touch.
- **Speaking:** for `hearing` of a `say` event (whose entity is the speaker), when the listener's
  own answer is false, each intercom feeding the speaker that stands in the listener's room is
  tried as the speaker: `heardAtVolume(snapshot, listener, intercom, event)`, true `intercom`.
  Only `say` is carried out; the speaker's other sounds are not.
- **What follows unchanged:** `perceivers`, `observe`, the actor view and a `wait` until sensed
  read `perceive`. An unpowered speaker cannot `say` at all (the previous item), and an intercom
  whose walk fails carries nothing either way.
- **Lab** (`scenarios/lab.json`): an intercom in the dormitory, `powered_by` the generator and
  `controlled_by` the terminal. A step right after A in the first test of
  `tests/scenario-lab.test.ts`: the terminal says `wake` with `perceivers`, and every subject
  hears it, basis `intercom`; ann answers `who` and the terminal hears her. The later steps are
  unchanged, and J shows the intercom silent with the generator gone.
- **Tests:** `tests/intercom.test.ts`, a small world: a fed agent hears a normal `say` in the
  intercom's room and not a whisper far from it, not a take (`quiet`), not a sound next door; its
  own `say` is heard by a body in the intercom's room and not one beyond NEAR of it for a
  whisper, not next door; a human's `say` beside the controller is not carried out; a destroyed
  or unpowered intercom carries nothing; an agent it does not feed hears nothing through it; a
  subject's actor view lists the controller's `say`.
- **Docs:** new `docs/intercom.md` and its `docs/DESIGN.md` line; the basis `intercom` in
  `docs/senses.md` and `docs/perception.md` (at its cap: split it if needed); `docs/power.md` one
  line (an intercom is a device), split if past its cap; `docs/limits-lab.md` (C: a camera still
  carries no sound; the AI speaks where it has an intercom).
- **Depends on:** a controller's own power (built). **Not in it:** delay, recording, a human
  using an intercom, broadcast across rooms beyond those that hold one, volume changed by the
  device.

### The lab's acceptance table

The roadmap ends in a table of eight acceptance rows. Each is now buildable, but they are spread
over several tests and steps. One file states them, row by row, against `scenarios/lab.json`, so
the lab's first milestone has a single place that says it holds.

- **File:** `tests/acceptance-lab.test.ts`, one `test` per row, each from a fresh world built from
  `scenarios/lab.json` (with the seed if the jam item has made it seeded), short, with no engine
  change. Where a row repeats a step of `tests/scenario-lab.test.ts`, it is repeated on purpose.
- **Rows:**
  1. The AI remotely locks a powered, connected door: the terminal's `lock` of the exit door is ok
     with no key, and it sees the door locked through the camera.
  2. The controller loses power: with the generator destroyed, the terminal's `lock` is
     `unpowered` `{ at: terminal, cut: generator }` and the door is unchanged.
  3. A human outside a camera's coverage: a subject in the dormitory is `false` to the terminal's
     sight, in the corridor `true` / `camera`, and the terminal's actor view lists the second and
     not the first.
  4. A manipulator reaches for an inaccessible object: with the key placed by the author beyond
     its `reach_cm`, the arm's `take` is `unresolved` (it names only what it can grope for); with
     the key in ann's grip beside it, `held_by_another`. Neither moves the key.
  5. A human and the AI act on a door in the same window: the terminal closes the open exit door
     (`closing`), ann opens it within the window and the terminal's `lock` is refused `closing`;
     a second close runs out and the lock is ok.
  6. The experiment's final condition is unmet: a watch for stage 1 on the exit door locked and
     `outside` not occupied, with a subject outside, leaves `stage` at 0 through many ticks, and a
     deadline sets it to -1.
  7. An agent inspects state it may not: bob's actor view `inspect` of the key in the lab and of
     the experiment are `null`, and a command naming another actor's alias is `unresolved`.
  8. The same initial state and commands replay identically: two worlds sent the same give the
     same stored files byte for byte, and `verify` is ok.
- **Docs:** `docs/limits-lab.md`'s opening names the file beside the scenario test.
- **Depends on:** a door that takes time to shut (row 5), a controller's own power (built), and
  after the jam item and the intercom if they come first, whose lab changes it must tolerate.
  **Not in it:** simultaneous commands (out of scope), new mechanics of any kind.
