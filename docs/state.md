# State model

A snapshot contains entities, a tick, a version, a sequence number, the template hash, coverage,
and what is scheduled, when anything is ([schedule.md](schedule.md)).
Entities refer to room locations, support surfaces, and containers by ID, and may be hidden under or
behind something by ID (`concealed_by`, a row in [relations.md](relations.md)). Position is stored
for entities supported by a room and derived through the support or containment chain otherwise;
`location` is always the room at the end of that chain.

`validateSnapshot` is the one pure check: no support or containment loop, `pos` exactly when the
support is a room, `location` the room at the end of the chain, every reference present (a detached
entity's origin is history, not a link), detached parts accounted for, no part stored at its default
(`part_at_default`), integrity in 0–100, and ids below `next_seq`. An entity's template is one of the
registry's own keys (`unknown_template`) and a reference names one of the entities' own keys, so
`constructor` or `__proto__` is neither a template nor an entity. Entity props hold to the same
schema as their template: each must be declared by the engine or the template (`undeclared_prop`),
typed correctly (`wrong_prop_type`), and have a declared prop satisfying every `requires` it names
(`unmet_requires`). It also holds the relations to their own rules: never both supported and
contained, a room never placed (`room_placed`), a door's sides are rooms, and what a key's `opens`
names can be opened. [relations.md](relations.md) names every relation, its kind, and the code that
enforces it. A world that breaks one rule does not open; the CLI reports `invalid_snapshot` and the
rule. Every accepted command and edit is checked before it is written.

Templates declare parts, dimensions, mass, properties, break products, and residue. Only declared
parts exist. Part state records integrity and whether a part is intact, damaged, detached, or
destroyed, stored only where it differs from the template; detachable subtrees become entities of
the `<template>.<part>` template ([structure.md](structure.md)). A human hand's thumb holds 20 of
its 50 `manipulation`. A registry with a detachable part but no such template is rejected. A
template prop `abstract` makes its entities marks rather than things: no agent may address one, it
is not perceived, and it neither hides nor lies under anything — abstractness is read from the
template, so a registry that gains the prop makes the world's own entities abstract.

Capacities sum part contributions and unexpired modifiers, clamped to 0–100; templates with no parts
have none. Structural capacity leaves the modifiers out, so a stunned carrier keeps hold of what it
carries. A part that declares `holds` is a grip for one item or a space for what fits; carried
things name it in `in_part` ([carrying.md](carrying.md)). Residue records amounts on its receiver.

Support loss emits displacement and fall events; high falls break entities, spawn their products,
and move liquids and solids to the landing surface. Removing a holder passes what it held into the
relation the holder itself was in. Moving either end of a concealment uncovers it under a `revealed`
event: taking, pushing, walking, a fall, a placement, or removing what was doing the hiding.
