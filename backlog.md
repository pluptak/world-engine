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

1. [An actor's view names nothing by a world id](#an-actors-view-names-nothing-by-a-world-id).
2. [The AI watches its arm](#the-ai-watches-its-arm).
3. [A panel a subject can use](#a-panel-a-subject-can-use).

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

### An actor's view names nothing by a world id

An actor's view reads its own aliases back to ids and passes anything else on as text
(`unalias` in `src/actor-world.ts`), so a raw world id (`e12`, `e12.hand_l`) passes too and
resolves as the id it is. Reach and perception still gate what it can reach, but the view takes a
name the actor was never given, and ids are sequential, so a caller can count through them;
`docs/actor-view.md` describes aliases only.

- **Change** (`src/actor-world.ts`): a target or a string argument that is not one of the actor's
  aliases but is an entity address (`isAddress` there: an entity id, with or without `.part`) is
  read back to a value that names nothing, so the world answers it as it answers another actor's
  alias: `unresolved` for `command` and `check`, `null` for `inspect`. Names and every other
  string pass as now. The value chosen must never match an id, alias or name (a character names
  cannot hold, or the view answering `unresolved` itself without a call; the builder picks one and
  says which).
- **Tests:** `tests/actor-world.test.ts`: a view's `command`, `check` and `inspect` with a raw id
  of a thing the actor sees are `unresolved` / `null`, while its alias and its name work; a raw
  `entity.part` the same; a raw id in an argument (`give`'s `destination`) the same; the world's
  own `command` with the raw id unchanged. Any existing test that passed a raw id to a view moves
  to the alias.
- **Docs:** `docs/actor-view.md` one sentence: a world id names nothing in a view.
- **Depends on:** nothing. **Not in it:** a keyed alias hash (the open note in `actor-view.md`),
  names that look like ids (a name equal to an id is read as that id, so it names nothing either).

### The AI watches its arm

The arm works blind: the lab room has no camera (`docs/limits-lab.md`, C), so the terminal drives
the arm without seeing what it takes. A second camera, on the same cable, is a scenario change and
nothing else, and shows what driving two bodies from one caller looks like.

- **Lab** (`scenarios/lab.json`): `lab_camera`, template `camera`, in the lab at (300, -300),
  `powered_by` the cable and `controlled_by` the terminal.
- **Steps that change** (`tests/scenario-lab.test.ts`): C, where ann's take in the lab reached ann
  alone and the terminal did not see the key, now has the terminal among the take's sight
  perceivers, basis `camera`; what C showed (an act out of every camera's sight reaches only who
  stands there) moves to the server room or wherever the build finds no camera, or is dropped from
  limits if nowhere is left. Any other step the camera changes is updated and named in the commit.
- **The arm test** gains the terminal's side: before the arm takes the key, the terminal sees it
  (`camera`); after, it sees the key in the arm's grip; once bob cuts the cable it sees neither,
  and the arm's drop is `unpowered` as now. The two views name the key by different aliases
  (`aliasOf(terminal, key)` and `aliasOf(arm, key)` differ), so the test drives the arm by name,
  as a caller holding both views must.
- **Docs:** `docs/limits-lab.md` (C rewritten; a new line: a caller driving the terminal and the
  arm sees one key under two aliases and matches them by name, which two keys of one name would
  defeat).
- **Depends on:** nothing. **Not in it:** any engine change; one alias across a controller's
  bodies (a decision for the maintainer, recorded only as a limit).

### A panel a subject can use

Only the terminal works the exit door from afar; a subject must stand at the door with the key.
The roadmap's devices have "local versus remote control, permissions": a panel is the local
control, and reaching it is the permission. The AI and a subject at the panel can then both work
the door, in turn, each command against the world as the last left it.

- **Prop and template:** `panel` (definition, boolean) in `src/engine/fields.ts`;
  `templates/panel.json`: 30×10×40, 3 kg, not an agent, `panel: true`.
- **A panel is a link** on a device's control walk (`controlled_by` from the device names the
  panel, the panel names the controller), so the controller works through it as through any link,
  and a destroyed or unpowered panel is `disconnected` / `unpowered` for the controller too.
- **Working a device at a panel** (`src/engine/verbs/openable.ts`): an actor that is not the
  controller, cannot reach the device, and reaches (`inReach`) an intact panel on the device's
  control walk works the device as the controller does: no reach to the device, key or hands, the
  fault taken on the walk from the device to that panel, the panel included, the rest of the walk
  to the controller not. An actor that can reach the device works it by hand as now. The nearest
  such panel on the walk (first from the device) is the one used.
- **Addressing:** `gropable` (`src/engine/query.ts`) and the name match in `src/engine/resolve.ts`
  also allow a device whose control walk passes through a panel the actor reaches, as they allow
  the controller; `options` then offers it. A helper beside `controller` in `src/engine/power.ts`
  (`panelFor(snapshot, device, actor)`: the panel used, or null) serves all three.
- **Lab** (`scenarios/lab.json`): a panel in the server room at (-300, 0), `powered_by` the
  generator, `controlled_by` the terminal; the exit door's `controlled_by` becomes the panel. A new
  test in `tests/scenario-lab.test.ts`: the terminal locks the exit door; ann opens the server
  door, stands at the panel and unlocks and opens the exit door through it with no key; the
  terminal closes and, after the shut, locks it again; ann destroys the panel and the terminal's
  `unlock` is `disconnected` `{ at: panel }`, while ann's own key still works by hand. The earlier
  steps keep their results (the walk now passes through a powered panel; any jam the seed moves is
  repinned and named in the commit).
- **Tests:** `tests/panel.test.ts`, a small world: a human at a panel opens, closes, locks and
  unlocks a door in another room with no key; out of the panel's reach the door is `unresolved`
  by name; a human beside the door works it by hand, with its key, even when a panel is near; an
  unpowered panel or a cut link between door and panel refuses the human `unpowered` /
  `disconnected`, a link beyond the panel does not; the controller works through the panel and is
  refused at a destroyed one; a jamming door jams a panel's command too (it is remote).
- **Docs:** new `docs/panel.md` and its `docs/DESIGN.md` line; `docs/power.md` one line (split if
  past its cap); `docs/verbs-openables.md` one line; `docs/limits-lab.md` (who may use the panel is
  whoever reaches it; the AI and a subject undo each other in turn).
- **Depends on:** nothing. **Not in it:** a keyed or locked panel, panels for cameras, intercoms
  or the arm, the AI seeing who stands at the panel beyond its cameras, priority between the
  controller and a panel.
