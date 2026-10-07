# Limits: the camp

What `scenarios/camp.json` (a dark tent, a lantern, a note under a book, bread, a hungry body) could
not say, and what the engine does instead. One line per limit, with the test that shows it: `C` is
`tests/scenario-camp.test.ts`. Nothing here is a proposal.

- Light has no reach or strength: a burning lantern lights the whole room, so anyone in the tent sees
  everything in it, and one burnt out leaves it entirely dark (C step B, D).
- A rate is fixed in the template: hunger rises a point every ten ticks whatever the body does, so
  resting, working or being cold changes nothing (C step C).
- Starvation never falls: eating withdraws the starving and hunger drops, but the count a body has
  reached stays where it was (C "a body that eats").
- A thing is eaten whole or by the amount of a liquid: bread cannot be half eaten, and nothing
  but `hunger` is lowered by it, with no thirst, no spoilage, no difference between foods.
- A search changes nothing and records no finder: the note stays under the book, and the `found`
  event names the book (C step B).
