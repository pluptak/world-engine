# Limits: the camp

What `scenarios/camp.json` (a dark tent, a lantern, a note under a book, bread, a hungry body) could
not say, and what the engine does instead. One line per limit, with the test that shows it: `C` is
`tests/scenario-camp.test.ts`. Nothing here is a proposal.

- Light has no reach or strength: a burning lantern lights the whole room, so anyone in the tent sees
  everything in it, and one burnt out leaves it entirely dark (C step B, D).
- A rate follows a prop, not the body's doing: hunger rises at `hunger_every` whatever the body does, so
  resting, working or being cold changes the rate only when a caller writes the prop (C step C).
- A thing is eaten whole, by portions or by the amount of a liquid, and nothing but `hunger` is lowered
  by it: no thirst, no spoilage, no difference between foods, and a portion is a count, not a size
  (C "a body that eats").
- A search changes nothing and records no finder: the note stays under the book, and the `found`
  event names the book (C step B).
