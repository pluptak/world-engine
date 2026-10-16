# State model

A snapshot contains entities, a tick, a version, a sequence number, the template hash, coverage, and
what is scheduled, when anything is ([schedule.md](schedule.md)). Entities refer to room locations,
support surfaces, and containers by ID, and may be hidden under or behind something by ID
(`concealed_by`, a row in [relations.md](relations.md)). Position is stored for entities supported
by a room and derived through the support or containment chain otherwise; `location` is always the
room at the end of that chain.

`SnapshotValidation` is the one pure check. No loops; `pos` exactly under a room, `location` the
room at the chain's end. Every reference names what exists (a detached origin is history, not a
link); detached parts are accounted for; no part is stored at its default; integrity runs 0–100; ids
stay below `next_seq`. A template is one of the registry's own keys (`unknown_template`) and a
reference one of the entities', so `constructor` or `__proto__` is neither. What a container holds
fits its `inner_*_cm`, for scenarios, edits and clock causes as for verbs. Props hold to their
schema ([fields.md](fields.md)). Relations hold to theirs ([relations.md](relations.md)): never both
supported and contained, a room never placed, a door's sides are rooms, and what a key's `opens`
names can be opened. A world that breaks one rule does not open; the CLI reports `invalid_snapshot`
and the rule. Every accepted command and edit is checked before it is written.

Only declared parts exist. Part state records only what differs from the template; detachable
subtrees become `<template>.<part>` entities ([structure.md](structure.md)). A template prop
`abstract` makes marks rather than things: no agent may address one, it is not perceived, and it
neither hides nor lies under anything ([space.md](space.md)); `scenery` is the reverse
([scenery.md](scenery.md)). Both are read from the template, so a gained flag changes live entities.

An entity may carry `traits`: at most 16 keys (`^[a-z][a-z0-9_]{0,31}$`) to opaque tokens (the `say`
rule), absent when empty and refused `invalid_trait` otherwise. Only a scenario or an `edit spawn`
writes them, and no rule reads them.

Capacities sum part contributions and unexpired modifiers, clamped to 0–100; templates with no parts
have none. Structural capacity leaves the modifiers out, so a stunned carrier keeps hold of what it
carries. A part that declares `holds` is a grip for one item or a space for what fits; carried
things name it in `in_part` ([carrying.md](carrying.md)). Residue records amounts on its receiver
([liquids.md](liquids.md)).

Support loss emits displacement and fall events; high falls break entities, spawn their products,
and move liquids and solids to the landing surface. Removing a holder passes what it held into the
relation the holder itself was in. Moving either end of a concealment uncovers it under a `revealed`
event: taking, pushing, walking, a fall, a placement, or removing what was doing the hiding.
