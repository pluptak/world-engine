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
  - *derived*: the engine only (`location`, `status`, `version`, `tick`, `next_seq`, `schedule`,
    `rng`, `modifiers`).
- **One stored value per fact.** An architect form is a second way to write a state field, never a
  second stored field: `fuel: "half"` is written as the number; read back it is bucketed.
- **Architect forms are coarse:** plain values (open, locked, lit, name, links), or named levels the
  engine converts: `fuel` fresh/half/stub, `liquid` empty/half/full, condition
  intact/damaged/broken. The architect never sees raw quantities, part integrities or tuning.
- **One schema is the source of truth.** Role checks, architect-form conversion, custom props,
  inheritance, refinement and the catalogue view all read it.
- **Architect is setup-only for now.** Its rules are a role, so allowing it mid-story later is
  additive. Whether to allow it (preparing the next chapter) is open.
- **World author: any state the world could reach, never a definition.** A shut door that is
  `openable: false` is out; a severed leg or half-burnt fuel is in.
- **Refinement is a validated transition** to a more specific preset, not a field write.

## Open

- Can the architect place something already `broken`, or only intact/damaged (and place the
  shards themselves)?
- `full` for a vessel without inner dimensions (the bottle): its template default amount?
- `closes_after`: definition (a self-closing door is its own preset), or a state with a form?
- Whether and when the architect role opens after tick 0.

## Blocks

One block per session, in this order. Each touches the shared registration points CLAUDE.md lists
(`verbs/index.ts`, `errors.ts`, `contract.ts`, `tests/property-gen.ts`, `docs/verbs.md`) only for
what it adds, and keeps docs within their caps (≤ 40 lines, ≤ 100 columns, indexed in
`docs/DESIGN.md`). Done = `npm run check` passes, one new test broken and restored, diff read.

### 1. Field schema

- New `src/engine/fields.ts`: one table for every entity field and every prop the engine reads:
  type, tier, `requires` (e.g. `locked`, `open`, `closes_after` → `openable`; `gap_cm` →
  `barrier`; `container` → `inner_w/d/h_cm`; `burning`, `fuel` → `light_source`), and the
  architect form if any (none used yet).
- Props no code reads (`hunger_every`, `starvation`) are declared by their template in a new
  `fields` key (tier + type), merged by key through `extends` in `src/templates.ts`.
- `resolveTemplates` refuses, naming the template and prop: an undeclared prop (`openabel`), a
  wrong type (`gap_cm: "12"`), a missing requirement.
- Declaring `fields` on `human_hungry` changes `templates_hash`: say so in `docs/templates.md`.
- Tests: `tests/fields.test.ts` (each refusal; every shipped template passes; the table covers
  every `props.<name>` the source reads, found by a scan like `tests/catalog.test.ts` does).
- Doc: `docs/fields.md`.

### 2. Merging prop edits; derived fields guarded

- New edit kind `update_props` (`src/engine/verbs/edit.ts`, `contract.ts`): merges the keys sent;
  `set_props` keeps replacing for the world author.
- A spawn override or edit that writes a derived field is refused `derived_field` unless it equals
  what the engine derives (scenarios that spell `location` keep working).
- Tests in `tests/edit.test.ts`.

### 3. Roles enforced

- `edit` carries `role` (default `world`, carried through the log like `perceivers`):
  a definition is refused `field_not_editable`, a derived field `derived_field`.
- Scenarios (`src/scenario.ts`, `createWorld` in `src/api.ts`) are checked under the `architect`
  role: only fields with an architect form, and placement/name. No `architect` edit after setup
  yet.
- Migration: tests and scenarios that set definition props through `edit` or overrides move to
  presets or fixtures; inventory them first and report the count.
- Tests: `tests/roles.test.ts`; existing `scenario-*` tests stay green.

### 4. Architect forms

- Named levels in `fields.ts`: `fuel` fresh/half/stub as shares of the preset's default;
  `liquid` empty/half/full against the vessel's capacity (inner volume); condition
  intact/damaged as fixed integrities. Converted on write, bucketed on read (pure, integer).
- Scenario overrides accept the forms; the open questions above are settled at block start.
- Tests: round-trip write → read; exact values never reach the architect form.

### 5. Catalogue view

- `catalog()` on `World`/`src/api.ts` and a CLI `catalog` op: every pickable preset with its
  shown definition fields (size, mass, `container`, `surface`, `openable`, `barrier`,
  `light_source`, `agent`, part names, capacities, break products) and its architect fields with
  defaults. Tuning fields are absent.
- Not listed: companion templates, break products, and bases marked `"catalog": false` (a new
  template key, distinct from the entity prop `abstract`).
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

- New edit kind `refine { target, template }`, world author only for now (an architect form
  follows the mid-story decision).
- Refused unless the new preset descends from the current one through `extends`
  (`not_a_refinement`); a stored part state must name a part the new preset has, a detachable
  one its companion; contents must still fit (inner size, grips) and the entity must still fit
  where it stands (refused, never displaced); scheduled causes and processes on the entity are
  re-checked against the new preset.
- State fields the new preset's schema still lists carry over; definitions come from the preset.
- Runs through the pipeline and `validateResult` like every edit. Tests: `tests/refine.test.ts`,
  including a table refined to a smaller one under a book that no longer fits.
