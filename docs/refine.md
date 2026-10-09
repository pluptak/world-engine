# Refinement

`edit` kind `refine { target, template }` makes an entity a more specific preset without
respawning it: a lantern a candle, a table a smaller table. World author only; a beat cannot
carry it, and the architect never acts after tick 0 (`src/engine/refine.ts`).

**Which presets.** Only one that extends the entity's own, directly or through others, else
`not_a_refinement`. A resolved template keeps `lineage`, its ancestors nearest first, for this;
it is saved in a world's `templates.json` and left out of `templates_hash`, so a set written out
in full hashes the same ([templates.md](templates.md)). An unknown template is `invalid`
(`unknown_template`). A world stored before templates kept `lineage` has none, so every refinement
of it is `not_a_refinement` until `upgradeTemplates()` rewrites its set; the hash does not change.

**What changes.** `template` becomes the new preset, and so do its definitions. State the entity
has stays where the new preset still declares the field: a lantern's 5 fuel is a candle's 5, not
the candle's 8. Stored part state is rebuilt against the new defaults, so a part at its new
default leaves the record. One `edited` event says `{ field: "template", from, to }`; the deltas
are `template`, `props` and `parts`. Processes the new preset adds or redefines run from then on.

**Refused, and nothing changes:**
- `unknown_part`: a stored part the new preset has no part of; `integrity_out_of_range`: one
  stronger than the new `max_integrity`.
- `too_large` (`{ item_cm, space_cm }`): the entity no longer fits the surface it stands on, or
  something on it no longer fits it; `not_a_surface`: it was one and no longer is, with things on it.
- `liquid_exceeds_capacity` (`{ held, capacity }`): more liquid than the new `capacity_cm3`.
- Contents that no longer fit (`container_contents_too_large`, `part_contents_too_large`,
  `grip_occupied`) are the snapshot's own rules, held on the result like any edit's.

Nothing is displaced: a refinement that would need something moved is refused.
