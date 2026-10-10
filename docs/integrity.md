# A thing's own integrity

A template with no `parts` may declare `max_integrity`, a top-level integer from 1 to 100
([templates.md](templates.md)). Such a thing starts at it, wherever it is made; an override or an
`integrity` a spawn gives still sets it. Absent means 100. It is inherited through `extends` as any
field, and refused when the set loads if the template has parts or the value is out of range.

**Rule.** A partless entity whose `integrity` is above its template's max is
`integrity_out_of_range` (`src/engine/validate.ts`). An `edit` spawn that sets it so is refused that
code. A scenario entry may not write integrity at all ([forms.md](forms.md)): its `condition`
`intact` is the max, `damaged` half of it, which is 100 and 50 for a template with no max.

**Attack** is unchanged: damage comes off the stored integrity, and 0 destroys. The cable
(`templates/cable.json`, 40) takes one human blow.

Not in it: a `damaged` status for partless things, armour or damage by material, and repair.
