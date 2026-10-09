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

Blocks 1 (field schema), 2 (`update_props`, `derived_field`), 3a (definitions are not written),
3b (entity props hold to the schema), 3c (traits), 4 (architect forms), 4b (scenarios are the
architect) and 5 (catalogue view) are built: `docs/fields.md`. One
block per session, in this order. Each touches the shared registration points CLAUDE.md lists
(`verbs/index.ts`, `errors.ts`, `contract.ts`, `tests/property-gen.ts`, `docs/verbs.md`) only for
what it adds, and keeps docs within their caps (≤ 40 lines, ≤ 100 columns, indexed in
`docs/DESIGN.md`). Done = `npm run check` passes, one new test broken and restored, diff read.

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
