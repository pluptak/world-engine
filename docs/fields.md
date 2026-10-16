# Fields

`Prop.cs` is the one schema of what an entity may carry. `Prop.Table` lists every prop the engine
reads, with its type (`boolean`, `integer`, `string`, or `id`, a string naming an entity), its tier
and the props it `requires`; every other entity field has the tier the list below gives it, held by
the rules that read it; `min`, `max`, `divides` bound an integer prop. What a scenario may write,
and its forms: [forms.md](forms.md). `PropTests` checks the table against TypeScript's, and a props
bag indexed by a literal key fails `TemplateValidationTests`.

**Tiers**, by who may write the field:

- *definition*: the template author only, such as `openable`, `closes_after`, `barrier`, `gap_cm`,
  `reach_cm`, and the entity's `template`;
- *state*: the world author, such as `open`, `locked`, `burning`, `fuel`, `liquid_amount`, a
  door's `from`/`to`, a key's `opens`, `blind`, `deaf`, `bound`, `possessed_by`, `possessor`,
  `lapses_at`, `appearance`, `name`, placement, `integrity`, `status`, `detached_from` and part
  state (a corpse or a severed limb is a state the world can reach);
- *derived*: the engine only: `id`, `location` and `modifiers`.

A spawn (an edit's or a scenario's) writing a derived field as other than the engine derives it is
refused `derived_field`; definitions that differ are refused `field_not_editable`. A replacing write
(`set_props`) may not drop one; repeats pass, and overrides merge as `update_props` merges.

**A prop the engine never reads** is declared by the template that uses it, under `fields`, with a
tier (`definition` or `state`) and a type (`boolean`, `integer` or `string`):

```json
"fields": { "hunger_every": { "tier": "definition", "type": "integer" } }
```

`fields` merge by name through `extends`, the child's own winning; an engine prop is refused.

**Checked when a set is resolved** (`TemplateValidation.ValidateProps`), loaded from
`templates/` or parsed from a world's `templates.json`: a prop neither table declares, a value of
the wrong type, a prop whose declared props do not supply its `requires` (a door's `from`/`to` →
`openable`), a process naming an undeclared prop, or an adjustment of a non-integer.

**Every entity's props hold to that schema in `SnapshotValidation`**: `undeclared_prop`,
`wrong_prop_type` and `unmet_requires` when the template grants no required prop — the entity's own
props never satisfy a requirement, since they never change what the template is: an openable stone
is a template of its own. `edit` refuses them; a scenario and `verify` record them as
`invalid_snapshot`.