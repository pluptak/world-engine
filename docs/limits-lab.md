# Limits: the lab

What `scenarios/lab.json` (eight subjects, a corridor, a lab, a server room, an exit door locked
with its key in the lab, the AI's terminal and an experiment's stage) could not say, and what the
engine does instead. One line per limit, with the step of `tests/scenario-lab.test.ts` that shows
it. Nothing here is a proposal.

- Nothing is the AI: an agent is a body, so the terminal is one more agent with sight, hearing and
  speech, and who it acts for, and what losing it means, is the caller's (A).
- Escape is no event: a subject who leaves is a subject whose `location` is `outside`, which a
  caller reads with `fact` (B).
- No camera: the terminal senses its own room and nothing else; an act in the lab reaches whoever
  stands there, and no device carries it further (C).
- No remote control: from the server room the terminal cannot name the exit door (`unresolved`),
  and a lock needs a body within reach, hands and the key in them; nothing connects a controller
  to a door (D).
- No manipulator: no agent moves things at another's command, and the terminal has no
  `manipulation` of its own (D).
- No power: nothing is powered or unpowered, and a prop no template declares, `powered` included,
  is refused `undeclared_prop` (E).
- A stage nothing advances: `stage` is a prop only the author's `edit` writes, so no escape or
  other condition moves it, and a subject's `edit` is `invalid_author` (E).
- An experiment no one perceives: an abstract entity answers sight `false` / `abstract`, so the
  stage is read through the trusted `World`, never through a view, the terminal's included (E).
- An open door blocks its footprint: only a barrier stands open to walking, so no subject can
  stand in a doorway to keep it from shutting; one the author puts there is moved aside (F).
