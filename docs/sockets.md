# Sockets

A severed part can be filled again: by its own severed limb (reattachment) or by an
entity made to fit it (an implant). Installing reverses severing, as `DetachPart` in
`AttackVerb.cs` spawns one out of it; parts have no identity until they detach.

**Fitting.** An installable template declares `fits`, the companion template it stands
in for (`human.arm_l`). It must have the same part names, parents and `holds` as that
companion; its own `contributes` and `max_integrity` are its own. A companion fits
itself without declaring `fits`.

**Verbs.** `install` takes the body and `args.part` (the stump) plus `args.item` (a
held entity of the companion template or one that fits it). It absorbs the item into
the body's part state and emits `installed { part, template }`. `extract` needs a part
with `Installed`; it spawns the installed template at the body's feet, detaches the
root, and emits `extracted { part, entity }`. Both need `manipulation` 50.

**Reading.** `Capacities.Structural` in `Capacities.cs` reads an installed part's
`contributes` from the installed template; holding (grips) is unchanged. A severing
attack spawns the installed template when one is set.

No nested sockets, no rejection or wear, no power or hacking of an installed part.
