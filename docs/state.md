# State model

A snapshot contains entities, a tick, a version, a sequence number, the template hash, and coverage.
Entities refer to room locations, support surfaces, and containers by ID. Position is stored for
entities supported by a room and derived through the support or containment chain otherwise;
`location` is always the room at the end of that chain.

`validateSnapshot` is the one pure check: no support or containment loop, `pos` exactly when the
support is a room, `location` the room at the end of the chain, every reference present (a detached
entity's origin is history, not a link), detached parts accounted for, integrity in 0–100, and ids
below `next_seq`. A world that breaks one does not open; the CLI reports `invalid_snapshot` and the
rule. Every accepted command and edit is checked before it is written.

Templates declare parts, dimensions, mass, properties, break products, and residue. Only declared
parts exist. Part state records integrity and whether a part is intact, damaged, detached, or
destroyed. Detachable subtrees become entities of the `<template>.<part>` template and retain their
origin in `detached_from`; a registry with a detachable part but no such template is rejected.

Capacities sum part contributions and unexpired modifiers, clamped to 0–100; templates with no parts
have none. Structural capacity leaves the modifiers out, so a stunned carrier keeps hold of what it
carries. Residue records amounts on its receiver.

Support loss emits displacement and fall events; high falls break entities, spawn their products,
and move liquids and solids to the landing surface. Removing a holder passes what it held into the
relation the holder itself was in.
