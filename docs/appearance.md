# Appearance: the face a body wears

A body may look like another entity: `appearance` (state, id) names the
entity it looks like; absent, itself. A scene entry's `props` or the
author's `update_props` writes it, and the named entity cannot be removed
while it is worn (`dangling_reference`).

An observer that senses the body by sight alone names it as the face: its
shown alias, name and template (`ActorWorld`, and `PlayerWorld` whose slot
bodies' senses merge). Touch and smell see through it. Facts, props,
parts, `holds` and `size_cm` stay the body's own, while every reference
to it (another fact, an event's `entity`, an id prop, `reason_data`) uses
the shown id.

A shown alias or name two bodies share answers `ambiguous` with both as
candidates, and nothing is applied. A body's true name still resolves
through the pipeline when nothing shown answers to it: the engine models
no knowledge. The omniscient record (`snapshot`,
`trace`, `since`, the trusted `observe` and `inspect`) keeps every id
and own name.

Not in it: a voice; a face as a part that moves between bodies; linking
two aliases to one body; a shown `parts` or `size_cm`.
