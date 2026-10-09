# Presets, field tiers and roles

The architect describes the intended world; the engine turns that description into exact
simulation state. Every block below keeps that line and every invariant in AGENTS.md.

## Decided

- **Catalogue = `templates/`.** The architect picks presets; it never authors templates. How new
  templates get authored is open and not part of this plan.
- **Single-parent `extends` stays the only inheritance.** It is an authoring tool for definitions,
  never runtime object inheritance. No multiple parents, no trait bundles, no categories nothing
  reads, no see-through barriers (all postponed).
- **Every field has one tier, by who may write it:**
  - *definition*: the template author only (`size_cm`, `mass_g`, `openable`, `container`,
    `inner_*_cm`, `barrier`, `gap_cm`, `break_fall_cm`, `attack_damage`, `processes`, …);
  - *state*: the world author exactly; the architect only through a declared architect form
    (`open`, `locked`, `burning`, `fuel`, `liquid_material`, `liquid_amount`, `integrity`,
    `hunger`, part state, placement, `name`, `aliases`, a door's `from`/`to`, a key's `opens`);
  - *derived*: the engine only (`location`, `version`, `tick`, `next_seq`, `schedule`, `rng`,
    `modifiers`). `status` and `detached_from` are state: a corpse or a severed limb is a state
    the world can reach (decided in block 2).
- **One stored value per fact.** An architect form is a second way to write a state field, never a
  second stored field: `fuel: 50%` is written as the number; read back it is a percentage again.
- **Architect forms are coarse:** plain values (open, locked, lit, name, links), whole percentages
  (`fuel` of the preset's default, `liquid` of the vessel's capacity) and the named levels of
  condition, intact/damaged, all converted by the engine. The architect never sees raw quantities,
  part integrities or tuning.
- **One schema is the source of truth.** Role checks, architect-form conversion, custom props,
  inheritance, refinement and the catalogue view all read it.
- **The architect only sets the scene up.** It acts before tick 0 and never after: from then until
  the simulation ends it places, changes and removes nothing.
- **World author: any state the world could reach, never a definition.** A shut door that is
  `openable: false` is out; a severed leg or half-burnt fuel is in.
- **Refinement is a validated transition** to a more specific preset, not a field write.
- **`closes_after` is a definition.** A self-closing door is its own preset (`extends` `door`); an
  author cannot make an ordinary door self-close mid-story, short of refinement.
- **An entity's props never change what its template is.** A state prop is allowed on an entity
  only when its template's resolved props meet the prop's `requires` (`open` needs the template's
  `openable`); the entity's own props never meet them. `open` on a stone is refused; an openable
  stone is a new template, made before the scene. A prop the template does not declare is refused
  too: inventing one is turning the thing into something else.
- **Description is not a prop.** What only describes, a brown and worn table, is a `trait`: an
  opaque token no rule reads, kept apart from props so it can never change behaviour (as `say`'s
  utterance is a token the engine never reads).
- **Scenarios are the architect; edits are the world author.** Nobody else writes state, so an
  edit needs no `role` field: who wrote is told by the channel.
- **One scenario entry is one entity, of a template.** The architect never places a set: nothing
  expands into break products, residue or anything else it did not name, so no consequence of a
  placement is hidden from it. A broken bottle that is still there is a template of its own; its
  shards are placed one by one. Condition is intact or damaged, never broken.
- **A scene is built only from templates.** Residue is no entity, so no scenario places it: wine
  on the floor at tick 0 is a template the architect places, or is not there.
- **The architect sets state only as it places an entity, and never changes it afterwards.** A
  barrel placed full stays the engine's from then on: moving its liquid into a glass is `pour`'s
  work, never the architect's.
- **The engine stores exact amounts.** A liquid percentage is converted on write to an amount
  (percentage × the vessel's capacity, so every vessel declares a capacity) and `pour` moves
  amounts. What an observer can tell of an amount is perception, not storage
  (`plans/candidates.md`).
- **Amounts are written as whole percentages,** liquid and fuel alike, floored, except that a
  percentage above 0 never comes to 0: a candle's 8 fuel at 10% is 1, so it still lights.
- **A consumable light source is removed when its fuel runs out.** A candle at fuel 0 leaves the
  world (its `burn` process `then` is `{ remove: true }`); a lantern goes dark and stays.

## Open

None.

## Blocks

Blocks 1 (field schema) and 2 (`update_props`, `derived_field`) are built: `docs/fields.md`. One
block per session, in this order. Each touches the shared registration points CLAUDE.md lists
(`verbs/index.ts`, `errors.ts`, `contract.ts`, `tests/property-gen.ts`, `docs/verbs.md`) only for
what it adds, and keeps docs within their caps (≤ 40 lines, ≤ 100 columns, indexed in
`docs/DESIGN.md`). Done = `npm run check` passes, one new test broken and restored, diff read.

### 3a. Definitions are not written

- A scenario's `props` override merges onto the template's props instead of replacing them
  (`copyOverrides` in `src/engine/spawn.ts`), as `update_props` merges.
- An edit (`spawn`, `set_props`, `update_props`) or a scenario entry whose definition props differ
  from the template's resolved props, by value or by being left out, is refused
  `field_not_editable`. Repeating the template's own value passes: an entity stores a copy of its
  template's props, so `set_props` always carries them. Derived fields stay `derived_field`. This
  is a check on writes, not a `validateSnapshot` rule, so `upgradeTemplates` is unchanged.
- Migration: only sites that change a definition, such as `closes_after` on `door` in five tests
  and by `set_props` in `tests/scenario-cell.test.ts`. A test's own fixture becomes a template in
  its inline registry; a shipped scenario uses a preset. Inventory first and report the count.
- Tests: `tests/roles.test.ts`: a changed, a dropped and a repeated definition through each write,
  and a merged scenario override; existing `scenario-*` tests stay green.
- Docs: `docs/fields.md` (the tier now enforced), `docs/api.md` (overrides merge).

### 3b. Entity props hold to the schema

- A rule in `validateSnapshot` (`src/engine/validate.ts`) holds every entity's props to
  `validateProps`' rules, against its template's resolved set: a prop neither `PROP_FIELDS` nor
  the template's `fields` declares is `undeclared_prop`, a value of the wrong type
  `wrong_prop_type`, a prop whose `requires` the template's resolved props do not meet
  `unmet_requires` (the entity's own props never meet it). So every edit, scenario, `verify` and
  hand-edited world meets it. Each would be accepted today: `update_props` with `gap_cm: "wide"` on
  a table, or `open` on a stone.
- Migration: a test that writes a prop no template declares (`rate`, `glow`, `temperature`, …)
  declares it under `fields` in its inline registry, or moves it to a trait (3c) where it only
  describes. Inventory first and report the count.
- Tests: `tests/entity-props.test.ts`: each code from an edit, a scenario and a hand-edited world
  under `verify`.
- Docs: `docs/fields.md`, `docs/state.md` (the new rule).

### 3c. Traits

- New optional entity field `traits`: a map of at most 16 keys (`^[a-z][a-z0-9_]{0,31}$`) to
  tokens (`^[A-Za-z0-9_.:-]{1,64}$`, the utterance rule in `docs/speech.md`), absent when empty,
  so stored worlds stay `schema_version` 5. Tier: state. Written by a scenario's overrides and
  an edit `spawn`; `validateSnapshot` refuses a bad key or token (`invalid_trait`).
- No rule reads it: a test runs `scenarios/inn.json` with traits on every entity and without, and
  every command answers the same status, reason code and events.
- `inspect` lists `traits` where it lists props (sight or touch); `observe` does not.
- Contract: `EntitySchema` and the edit and scenario shapes in `src/contract.ts`.
- Tests: `tests/traits.test.ts`. Docs: `docs/state.md`, `docs/projection.md`, `docs/api.md`.

### 4. Architect forms

- New definition prop `capacity_cm3` (integer > 0, `fields.ts`): how much liquid a vessel holds,
  apart from its box. `bottle` declares 750 and its default `liquid_amount` becomes 750 (full);
  `cup` declares 250. `liquidCapacity` in `src/engine/verbs/pour.ts` reads `capacity_cm3` where a
  template declares it, else the inner volume as today, so a chest still takes a pour.
- Five architect forms, accepted in scenario overrides only, converted on write to the one stored
  value (pure, integer):
  - `fuel_pct` (0–100), on an entity whose template declares `fuel`: that default × pct / 100;
  - `liquid: { material?, pct }`, on one whose template declares `capacity_cm3`: `liquid_amount`
    = capacity × pct / 100 and `liquid_material` = `material`, else the template's; pct 0 stores
    amount 0 and material `""`;
  - `condition`, `intact` or `damaged`: entity `integrity` 100 or 50;
  - `hunger_pct` (0–100), on one whose template declares `hunger`: `hunger` itself, which runs
    0–100 already;
  - `portions_pct` (0–100), on one whose template declares `portions`: that default × pct / 100.
  Percentages floor, except that one above 0 never stores 0 (a candle's 8 fuel at 10% is 1).
- A form is refused `invalid_form` (not a
  whole number 0–100, or an unknown condition), `form_not_applicable` (its template declares no
  prop the form converts to) or `no_liquid_material` (pct above 0 with no material either side).
- Migration: the bottle's 75 becomes 750 and the cup's 288 becomes 250 wherever a test, scenario
  or doc quotes them (inventory first, report the count); `docs/limits.md` drops the 75 cm³ line.
- Tests (`tests/architect-forms.test.ts`): the stored value of each form (full bottle 750, empty
  cup 0 with no material, a candle at 10% → 1 and at 0% → 0, `damaged` → 50, bread at 50% → 2),
  each refusal, a pour
  into a cup bounded by 250, and a chest still bounded by its inner volume.
- Docs: `docs/fields.md` (`capacity_cm3`, the forms), `docs/liquids.md` (capacity), `docs/api.md`
  (scenario overrides).

### 4b. Scenarios are the architect

- A scenario entry (`src/scenario.ts`) writes only placement, `name`, `aliases`, traits, the five
  forms and the plain state values `open`, `locked`, `burning`, `lit`, a door's `from`/`to` and
  a key's `opens`; any other prop, the raw `fuel`, `liquid_amount`, `liquid_material`,
  `integrity`, `hunger` and `portions` included, is refused `field_not_editable`. Edits stay the
  world author's and write any state.
- Migration: the shipped scenarios and the tests' scenario entries move to the forms
  (`scenarios/camp.json`'s `hunger: 100` → `hunger_pct: 100`); inventory first, report the count.
- Tests: `tests/roles.test.ts` gains the architect's refusals. Docs: `docs/api.md`.

### 5. Catalogue view

- `catalog()` on `World`/`src/api.ts` and a CLI `catalog` op: every pickable preset with its
  shown definition fields (size, mass, `container`, `surface`, `openable`, `barrier`,
  `light_source`, `agent`, `capacity_cm3`, part names, capacities, the templates it breaks into)
  and its architect forms with their defaults (`fuel_pct` 100, `liquid` at the template's
  material and percentage, `condition` `intact`). Tuning fields are absent.
- Pickable: every template but companions (`<template>.<part>`) and bases marked
  `"catalog": false` (a new template key, distinct from the entity prop `abstract`). Break
  products such as `glass_shard` are pickable: the architect places shards one by one.
- Response validated in `contract.ts`; tests in `tests/catalog-view.test.ts`.

### 6. Inherited companions

- A child that inherits its parent's parts and declares no `<child>.<part>` gets one resolved from
  `<parent>.<part>` (`missingCompanions` and resolution in `src/templates.ts`).
- Delete the six `templates/human_hungry.*.json`; a test holds `templates_hash` unchanged.

### 7. Parts merged by name

- New template key `part_overrides: { "<part>": { …fields } }`, shallow-merged onto the inherited
  part of that name; `parts` still replaces the whole list; an unknown name is refused.
- New `templates/quadruped.json` (`"catalog": false`); `dog` and `cat` extend it. A test holds
  their resolved templates identical to today's (the hash changes only by the new base).

### 8. Refinement

- New edit kind `refine { target, template }`, world author only (the architect never acts after
  tick 0).
- Refused unless the new preset descends from the current one through `extends`
  (`not_a_refinement`); a stored part state must name a part the new preset has, a detachable
  one its companion; contents must still fit (inner size, grips) and the entity must still fit
  where it stands (refused, never displaced); scheduled causes and processes on the entity are
  re-checked against the new preset.
- State fields the new preset's schema still lists carry over; definitions come from the preset.
- Runs through the pipeline and `validateResult` like every edit. Tests: `tests/refine.test.ts`,
  including a table refined to a smaller one under a book that no longer fits.
