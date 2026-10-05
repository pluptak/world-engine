# Templates

A template declares `id`, `size_cm`, `mass_g`, `parts`, `props`, `break_products` and
`break_residue`. Every one of them is data, read from `templates/*.json` by `src/templates.ts`.

A template may declare `"extends": "<parent id>"`. Resolution runs once, when the set is loaded or
parsed:

- the child's own field wins;
- `props` are shallow-merged over the parent's;
- `parts` are replaced only when the child declares them, so a declared list is the whole tree;
- `size_cm`, `mass_g`, `break_products` and `break_residue` are inherited unless declared.

Chains are allowed. A cycle, or a parent no template declares, is refused with the chain that
produced it (`Template extends cycle: a -> b -> a`). A template that declares too little and extends
nothing is refused by name, listing the fields it is missing.

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
