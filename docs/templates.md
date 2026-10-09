# Templates

A template declares `id`, `size_cm`, `mass_g`, `parts`, `props`, `break_products` and
`break_residue`, and optionally `spent_products` and `spent_residue`, `processes` ([processes.md](processes.md);
merged by id through `extends`, absent from a template that declares none) and `fields` ([fields.md](fields.md)).
All are data, read from `templates/*.json` by `src/templates.ts`. `"catalog": false` keeps a base out of the
architect's catalogue ([catalog.md](catalog.md)); it is the template's own and is not inherited.

**What being used up leaves.** `spent_products` (`{ template, count }`, a count a whole number from 0) and
`spent_residue` (material → amount) are to being used up what `break_products` and `break_residue` are to
breaking: the last portion of a thing eaten (`consume`), or a process whose `then` is `{ spent: true }`, leaves them
where the thing stood and removes it ([processes.md](processes.md)). Both default to empty, and a template that
leaves nothing carries neither key, so it hashes as it did before they existed. A child's own list or record
replaces its parent's, and one declared empty clears it. A product must name a template of the set, and not `room`, which nothing can be set on, and its count is a
whole number from 0: a set that breaks any of these is refused when it is read (a directory, a world's
`templates.json`), because the spawn that would fail has no way to refuse and would stop the clock. A world whose
templates would lose a product's template is refused `templates_lost_field` (`spent_products.<template>`), as a
break product's is.

A template may declare `"extends": "<parent id>"`, resolved once, when the set is loaded or parsed:

- the child's own field wins;
- `props` are shallow-merged over the parent's, and `fields` merged by name;
- `parts` are replaced only when the child declares them, so a declared list is the whole tree;
- `size_cm`, `mass_g`, `break_products`, `break_residue`, `spent_products` and `spent_residue` are inherited unless
  declared.

Chains are allowed; a cycle or unknown parent is refused with its chain (`Template extends cycle:
a -> b -> a`), and a root that declares too little by name, listing what it is missing.

Resolution finishes before anything else looks at the set, so no `extends` key survives it. The
templates hash, a world's frozen `templates.json`, and `upgradeTemplates` read only resolved
templates, and a world never needs a template file again: `templates/wine_bottle.json` declares only

```json
{ "id": "wine_bottle", "extends": "bottle", "props": { "liquid_material": "grape_wine" } }
```

and a set written out with `wine_bottle` spelled out in full hashes the same.

The companion rule is read off the resolved set too: a detachable part, inherited or declared, needs
a template named `<template>.<part>`, so a child of `human` needs its own `pupil.arm_l`, not
`human.arm_l`. A child that declares `"parts": []` inherits nothing and needs no companion.
A part may also declare `holds`: `{ "kind": "grip" }` holds one item (hands, and the jaws that
keep the mouth rules), while `{ "kind": "space", "inner_*_cm": … }` holds what fits, like a chest
(`human` pockets one). Holds travel with the part list a child replaces as a whole.

`upgradeTemplates` compares a new set against the live world by resolved field: a part a live entity
has in use and a break product that can no longer be spawned are what a new set may not take away.
Dropping `props.default_hit_part` only makes an attack naming no part `invalid_attack_target`.

Giving the human's `head` `speech` ([speech.md](speech.md)) and `human_hungry` its `fields` changed
`templates_hash`: a world stored before reports `templates_changed` until `upgradeTemplates`.
