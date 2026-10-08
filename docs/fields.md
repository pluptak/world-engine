# Fields

`src/engine/fields.ts` is the one schema of what an entity may carry. `PROP_FIELDS` lists every
prop the engine reads, with its type (`boolean`, `integer`, `string`, or `id`, a string naming an
entity), its tier and the props it `requires`; `ENTITY_FIELDS` gives every other entity field a
tier. `tests/fields.test.ts` scans `src/` for every prop it names, so a prop the code starts
reading must enter the table, and an entry no code reads is refused as dead.

**Tiers**, by who may write the field:

- *definition*: the template author only, such as `openable`, `barrier`, `gap_cm`, `reach_cm`, and
  the entity's `template`;
- *state*: the world author, such as `open`, `locked`, `burning`, `fuel`, `liquid_amount`, a
  door's `from`/`to`, a key's `opens`, `name`, placement, `integrity` and part state;
- *derived*: the engine only: `id`, `location`, `status`, `detached_from` and `modifiers`.

Nothing enforces tiers yet.

**A prop the engine never reads** is declared by the template that uses it, under `fields`, with a
tier (`definition` or `state`) and a type (`boolean`, `integer` or `string`):

```json
"fields": { "hunger_every": { "tier": "definition", "type": "integer" } }
```

`fields` merge by name through `extends`, the child's own winning, and are absent from a template
that declares none. Declaring one of the engine's props is refused.

**Checked when a set is resolved** (`validateProps` in `src/templates.ts`), loaded from
`templates/` or parsed from a world's `templates.json`, each refusal naming the template and prop:

- a prop neither table declares (`props.openabel is not a declared prop`);
- a value of the wrong type (`props.gap_cm must be an integer`);
- a prop without one it requires (`gap_cm` → `barrier`; `open`, `locked`, `closes_after` →
  `openable`; `container` → `inner_w/d/h_cm`; `burning`, `fuel` → `light_source`), which an
  ancestor may supply;
- a process naming an undeclared prop, adjusting one that is not an integer, or setting a value
  that is not of its prop's type.

Entity props written by a scenario or an edit are not checked here.
