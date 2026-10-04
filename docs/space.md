# Space: anchors, offsets and `near`

A position may be written against an anchor instead of in centimetres: `{ "anchor": ..., "dx": 10,
"dy": 0 }` where `pos` would take `{ "x": 10, "y": 0 }`. A scenario entry takes it in
`overrides.pos`, naming the anchor by scenario name or id; an `edit place` takes it in `pos`,
naming it by id, like every other edit reference. The offset is required: an anchor says where the
room's origin is, not where the thing is.

The offset resolves when the world is written, to the anchor's own position plus the offset, with
the anchor's room as the entity's `location` and `support`. Nothing records the anchor afterwards:
the entity is in that room at that position, exactly as if the numbers had been written out, so an
anchor adds no relation and appears in no table. Naming a holder (`location`, `support`,
`contained_in`) beside an anchor is `conflicting_placement`: the anchor already says where the
entity is.

An anchor must be a fixed point in a room: it stands on a room and its own position is a literal
one, never another anchor. Anything else is refused `anchor_not_room_supported` (the refusal
`edit place` returns too), and an anchor that names nothing is `unknown_anchor` in a scenario,
`no_such_entity` in an edit.

`templates/anchor.json` is a point with no size and no mass, and its template declares
`abstract: true`. An abstract entity is inert to agents: agent commands skip it, so every verb — and
every `put` or `give` destination — answers `unresolved` for one, and perception answers `false`
with the basis `abstract` in either form, for every covered sense. The world author can edit an
abstract entity: `place`, `remove`, `set_props` and `set_part` all succeed. It is still an entity
at a position, so an offset resolves against it and `near` reads it. The world author places it
through a scenario or a spawn, and nothing in the world moves it afterwards. `anchor` is the only
template that declares the prop.

`near` is a derived relation, answered by `fact` and never stored: true when both entities have a
position derivable through their support or containment chain, both are in the same room, and they
are at most `NEAR_THRESHOLD_CM` (100 cm) apart, compared as squared distances so the arithmetic
stays integral. Its basis is `derived_near`; with no object it is `false` / `no_object`, and with
an object that does not exist `false` / `no_such_entity`. `near` is in the default coverage, and a
world that does not declare it answers `unknown`. It never yields a position: only an explicit
offset writes one.
