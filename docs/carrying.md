# Carrying

What an agent carries is `contained_in` the agent, and `in_part` names the part of the agent it
sits in. A template declares which parts hold, with `holds`:

- `{ "kind": "grip" }` holds one item: a human's `hand_l` and `hand_r`, and the jaw of a dog, cat
  or horse, which keeps the mouth rules (`mouth_carry`, one item within `carry_limit_g`).
- `{ "kind": "space", "inner_w_cm": …, "inner_d_cm": …, "inner_h_cm": … }` holds what fits, like a
  container: a human's `pocket`, 18 × 12 × 4 cm, takes a note or a key, not a bottle.

`in_part` is set exactly when the holder declares holding parts, so a chest's or a cup's contents
leave it `null`. A part holds only while it and every part above it are intact or damaged: a hand
on a severed arm holds nothing.

A two-handed item (`hands_required: 2`) sits in one grip and also fills the lowest other grip. That
second grip is derived, never stored, so verbs, validation and loss always agree on it.

- `take` and `give` place the item in the lowest free grip of whoever receives it, or the grip
  `args.part` names. The capacity checks run first and keep their codes (`insufficient_*`,
  `two_hands_required`, `too_heavy`, `mouth_full`); after them, no free grip is `hands_full`,
  with `reason_data` `{free, need}`.
- `put … in <actor>.pocket` stows a held item in the actor's own space part, refused `too_large`
  with the numbers when it does not fit; `take` brings it back to a grip. Taking from another
  agent's grip or pocket is refused `held_by_another`: only `give` moves a thing between agents.
- `drop`, `give` and `pour` act on what is in a grip: a pocketed item is refused `not_in_hand`
  until it is taken out.
- Losing a part, by an attack or an edit, drops exactly what that part held, plus a two-handed
  item whose second grip it was. Other grips and an intact pocket keep theirs; what is left still
  answers to the structural capacity rule, so a stunned carrier holds on.
- A scenario entry or an edit that sets `contained_in` to a holder with grips and no `in_part`
  takes the first free grip, the way `location` is filled from the chain.

The rules and their codes are in [relations.md](relations.md); the per-verb bullets are in
[verbs.md](verbs.md).
