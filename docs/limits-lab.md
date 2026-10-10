# Limits: the lab

What `scenarios/lab.json` (eight subjects, a corridor, a lab, a server room, an exit door locked
with its key in the lab, controlled by the AI's terminal over a cable from a generator, and an
experiment's stage) could not say, and what the
engine does instead. One line per limit, with the step of `tests/scenario-lab.test.ts` that shows
it. Nothing here is a proposal.

- Nothing is the AI: an agent is a body, so the terminal is one more agent with sight, hearing and
  speech, and who it acts for, and what losing it means, is the caller's (A).
- Escape is no event: a subject who leaves is a subject whose `location` is `outside`, which a
  caller reads with `fact` (B).
- A camera sees its own room whole and lit, and nothing else: no sound, no cone, no view across a
  door, no record. The lab has none, so an act there reaches only whoever stands in it (C).
- The terminal sees the exit door it locks only through the corridor's camera, which shares the
  door's cable: one cut both blinds it and stops its unlock (D, E).
- A cut tells only where the control walk failed: with the cable destroyed the terminal's unlock
  is `unpowered` at the door, not at the cable, and a key still works by hand (E).
- An agent's own power is not modelled: an unpowered terminal still senses and acts (E).
- No manipulator: no agent moves things at another's command, and the terminal has no
  `manipulation` of its own (A).
- A stage nothing advances: `stage` is a prop only the author's `edit` writes, so no escape or
  other condition moves it, and a subject's `edit` is `invalid_author` (F).
- An experiment no one perceives: an abstract entity answers sight `false` / `abstract`, so the
  stage is read through the trusted `World`, never through a view, the terminal's included (F).
- An open door blocks its footprint: only a barrier stands open to walking, so no subject can
  stand in a doorway to keep it from shutting; one the author puts there is moved aside (G).
