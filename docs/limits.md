# Limits

What `scenarios/inn.json` could not say, and what the engine did instead. One line per
limit: what was wanted, what happens, and the step in `tests/scenario-inn.test.ts` that
shows it. Step letters are the command ids the script uses. Nothing here is a proposal.

- Smell is holding a liquid or carrying residue, never a property of the material:
  wanted the floor to smell of wine, got a room that smells because it carries residue,
  which is no different from a room that carried water (B6, E4).
- `liquid_amount` counts the cubic centimetres a vessel's inner dimensions declare, so
  the shipped bottle holds 75 cm³ and a cup of 288 cm³ is nearly four bottlefuls (B5).
- `concealed_by` is one relation with no "under" and no "behind": a search finds the
  note under the book and a lifted book uncovers it, but nothing records which (C1, C2).
- There is no social state: the key moves because a caller said so, and nothing records
  who may open the chest, or that ann handed it over at all (A7, A12).
- A spill is all or nothing: the falling cup keeps none of its 30 cm³, and there is no
  half spill (E2).
- Touch is all or nothing, and snatching from a hand isn't modelled: a pocket theft is unfelt,
  and taking from a hand is refused (B2c, G2).
- Sight has no facing: in a lit room the silent, unfelt pocket theft is still seen by its
  victim, so a theft goes unnoticed only in the dark (B2c).
- Silence is by event type, not by care: a `take` is silent whether it is a careful lift or a
  clumsy grab, and a `move` is heard however softly it is made.
