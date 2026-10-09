# Fields

`src/engine/fields.ts` is the one schema of what an entity may carry. `PROP_FIELDS` lists every
prop the engine reads, with its type (`boolean`, `integer`, `string`, or `id`, a string naming an
entity), its tier and the props it `requires`; `ENTITY_FIELDS` gives every other entity field a
tier; `min` is the least an integer prop may be. What a scenario may write, and its forms:
[forms.md](forms.md). `tests/fields.test.ts` scans `src/` for every prop it names, so a prop the
code starts reading must enter the table, and an entry no code reads is refused as dead.

**Tiers**, by who may write the field:

- *definition*: the template author only, such as `openable`, `barrier`, `gap_cm`, `reach_cm`, and
  the entity's `template`;
- *state*: the world author, such as `open`, `locked`, `burning`, `fuel`, `liquid_amount`, a
  door's `from`/`to`, a key's `opens`, `name`, placement, `integrity`, `status`, `detached_from`
  and part state (a corpse or a severed limb is a state the world can reach);
- *derived*: the engine only: `id`, `location` and `modifiers`.

**An entity's props never change what its template is.** An open stone is refused, and an
openable stone is a template of its own, made before the scene; so is a self-closing door, since
`closes_after` is a definition. What only describes a thing is a `trait` ([state.md](state.md)),
never a prop, so it can never change behaviour.

A spawn (an edit's or a scenario's) writing a derived field as other than the engine derives it is
refused `derived_field`; definitions that differ are refused `field_not_editable`. A replacing write
(`set_props`) may not drop one; repeats pass, and overrides merge as `update_props` merges.

**A prop the engine never reads** is declared by the template that uses it, under `fields`, with a
tier (`definition` or `state`) and a type (`boolean`, `integer` or `string`):

```json
"fields": { "hunger_every": { "tier": "definition", "type": "integer" } }
```

`fields` merge by name through `extends`, the child's own winning; an engine prop is refused.

**Checked when a set is resolved** (`validateProps` in `src/templates.ts`), loaded from
`templates/` or parsed from a world's `templates.json`: a prop neither table declares, a value of
the wrong type, a prop whose declared props do not supply its `requires` (a door's `from`/`to` →
`openable`), a process naming an undeclared prop, or an adjustment of a non-integer.

**Every entity's props hold to that schema in `validateSnapshot`**: `undeclared_prop`,
`wrong_prop_type` and `unmet_requires` when the template grants no required prop — the entity's own
props never satisfy a requirement. `edit` refuses them; a scenario and `verify` record them as
`invalid_snapshot`.
