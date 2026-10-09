# The catalogue

What the architect may place, before any world exists. `catalog(registry?)` (`src/api.ts`, from
`src/engine/catalog.ts`) answers for the shipped templates or a given set, `World.catalog()` for a
world's own, and the CLI's `{ "op": "catalog" }` for either (`world` names one; absent, the shipped
set). Entries are by template id, `{ catalog: [...] }`, the same every time.

**Offered:** every template but the companion of a detachable part (`human.hand_l`, found by the
part, not by the dot) and the bases that declare `"catalog": false`. That key is a template's own
and is not inherited: a child of such a base is offered. It is not the entity prop `abstract`.

**Shown:** `size_cm`, `mass_g`, `container`, `surface`, `openable`, `barrier`, `light_source`,
`agent`, `capacity_cm3` (when declared), `parts` (names), `capacities` (what the parts add up to),
`breaks_into` (each template once). Tuning (reach, damage, process timing) is not shown.

**`forms`:** the forms ([forms.md](forms.md)) the preset takes, with what leaving each out means:
`condition` `"intact"` always; `fuel_pct` 100 when it declares `fuel`; `liquid` `{ material, pct }`
when it declares `capacity_cm3` (the material it holds, null for none, and how full it starts, 0
for an empty vessel); `hunger_pct` as it starts, when it declares `hunger`; `portions_pct` 100 when
it declares `portions`. Spelling the defaults out places the same thing, except that an empty
vessel then stores a `liquid_amount` of 0 and no material where a plain one stores neither.
