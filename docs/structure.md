# Structure

A template declares the parts an entity has: a tree by `parent`, each with `max_integrity`, the
capacities it `contributes`, whether it is `detachable`, and whether it `holds`. The template is the
finest structure the world supports; an entity's `parts` record holds only what differs from it.

**Sparse state.** A part intact at its `max_integrity` is not stored: an absent entry reads as that
default (`partState` in `src/engine/parts.ts`). Writes go through `withParts`, which drops an entry
set back to the default, and `validateSnapshot` refuses a stored default (`part_at_default`), so
every state has one stored form. A spawned entity stores `{}`; carrying, pocketing, moving and
perceiving store nothing.

**What writes a part.** Only a transition with an event that names the part or an ancestor:
`damaged`, `destroyed`, `detached`, or an `edited` from `set_part`. Reading the template is not a
write and not an event, so there is no materialization step and nothing in the history for it.
`checkPartTriggers` in `tests/property-gen.ts` holds every generated step to this.

**Reading a part.** `effectivePart` gives a part's own state unless an ancestor is detached or
destroyed, in which case it shares that status: a thumb on a severed hand reads `detached`, a pocket
on a destroyed torso `destroyed`. Capacities count a part only while it and every ancestor are
intact or damaged. A `fact` may name one part, `<entity>.<part>`, for `status`, `integrity` and
`attached_to` ([perception.md](perception.md)).

**Severing.** A detached part's subtree becomes one entity of the `<template>.<part>` template with
`detached_from` naming its origin, and carries the subtree's state. The body keeps the severed root
alone (`part_under_detached` refuses an entry below it). A part gone before its ancestor was severed
rides on the new entity as `detached` and is accounted for back along `detached_from`. Parts have no
identity of their own until they detach; until then they are addressed as `<entity>.<part>`.

**Cost.** Structure no command reaches leaves no trace: the property test runs the same sequences
against templates with extra latent parts and gets byte-identical snapshots and events. A new set
may drop a part no entity stores and nothing sits in; `upgradeTemplates` refuses only a part in use.
