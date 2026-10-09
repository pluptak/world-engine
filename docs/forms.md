# Architect forms

A scenario is the architect's: it says what a scene holds, not the engine's raw quantities. Five
forms stand in for a stored value, are accepted in a scenario entry's overrides only (`edit` refuses
them as `invalid_args`), and are converted once, before any rule reads the entry
(`src/engine/forms.ts`). The stored value is the only one: a form written beside the raw prop it
converts to is `invalid_form`.

| form | needs the template to declare | stores |
| --- | --- | --- |
| `fuel_pct` 0–100 | `fuel` | `fuel` = default × pct / 100 |
| `liquid: { material?, pct }` | `capacity_cm3` | `liquid_amount` = capacity × pct / 100; material |
| `condition` `intact` or `damaged` | nothing | `integrity` 100 or 50 |
| `hunger_pct` 0–100 | `hunger` | `hunger` (it runs 0–100 already) |
| `portions_pct` 0–100 | `portions` | `portions` = default × pct / 100 |

Percentages are whole numbers and floor, except that one above 0 never stores 0: a candle's 8
fuel at 10% is 1, so it still lights. `liquid` with `pct` 0 stores amount 0 and material `""`;
above 0 it needs a material, the form's or the template's.

Refusals, as `WorldError` codes: `invalid_form` (not a whole number 0–100, an unknown condition,
a malformed `liquid`, or the raw prop also written), `form_not_applicable` (the template declares
no prop to convert to) and `no_liquid_material`.

`capacity_cm3` is a definition (an integer of at least 1): how much liquid a vessel holds apart
from its box. `bottle` declares 750 and starts full, `cup` 250; `pour` is bounded by it where
declared, else by the inner volume ([liquids.md](liquids.md)).
