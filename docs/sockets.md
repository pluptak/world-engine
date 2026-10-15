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

**Attempts.** An installable that declares `outcome_ticks` (at least 1) and `success_pct`
(0 to 100), with `failure_damage` optional (0 when absent), makes `install` an attempt
(`OutcomeTests`). `install` runs every check above, then emits `outcome_scheduled
{ part, item }` and schedules an `outcome` cause on the body `outcome_ticks` on
([schedule.md](schedule.md)); the item stays where it is. A world with no seed refuses it
`no_seed` unless `success_pct` is 100. When the cause falls due:
- the body or the item gone, the cause went with it and nothing is emitted;
- the item out of the body's reach, or the stump no longer detached, emits
  `outcome_failed { part, item, reason }` with `out_of_reach` or `socket_occupied`;
- otherwise one roll of the world's dice, none at 100: under `success_pct` emits
  `outcome_succeeded { part, item }` and installs as above, caused by it; else
  `outcome_failed` with `roll`, and the body takes `failure_damage` caused by it.
The odds read nothing but `success_pct`. The three events are silent. `robo_arm_l` is an attempt.

No nested sockets, no rejection or wear, no power or hacking of an installed part.
