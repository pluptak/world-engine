# Limits: the lab

What `scenarios/lab.json` (eight subjects, a corridor, a lab, a server room, an exit door locked
with its key in the lab, controlled by the AI's terminal over a cable from a generator, and an
experiment's stage) could not say, and what the
engine does instead. One line per limit, with the step of `tests/scenario-lab.test.ts` that shows
it. Nothing here is a proposal. The lab's acceptance rows, one test each, are in
`tests/acceptance-lab.test.ts`, beside the scenario test.

- Nothing is the AI: an agent is a body, so the terminal is one more agent with sight, hearing and
  speech, and who it acts for, and what losing it means, is the caller's (A).
- Escape is no event: a subject who leaves is a subject whose `location` is `outside`, which a
  caller reads with `fact` (B).
- A camera sees its room, lit, within its cone, and nothing else: no sound, no view across a door,
  no record. The lab's is whole; the corridor's is narrow, turned on the exit door (C, M). The
  dormitory has none, so an act there reaches only whoever stands in it. The AI hears that room
  through the intercom, which carries it and no other (C).
- The AI watches its arm with the lab camera, on the same cable: one cut blinds both. The terminal
  and the arm name the key by two aliases, so a caller holding both views matches them by name,
  which two keys of one name would defeat (arm test).
- The terminal sees the exit door it locks only through the corridor's camera, which shares the
  door's cable: one cut both blinds it and stops its unlock (D, E).
- The terminal runs on the generator itself, so a cut cable leaves it running; with the generator
  destroyed it neither acts nor senses, and its own refusal is all it learns of why (J).
- The arm (A) takes, puts and gives only within its reach, and sees and moves nothing; it acts only
  while the terminal's link to it carries, and the terminal has no `manipulation` of its own
  ([manipulator.md](manipulator.md)).
- A stage nothing but a watch advances: `stage` is a prop an author's `edit` or a beat writes, so
  no escape moves it, and a subject's `edit` is `invalid_author` (F). A watch reads its condition at
  most once a tick, so a condition that holds and lapses within one command is missed (I).
- An experiment no one perceives: an abstract entity answers sight `false` / `abstract`, so the
  stage is read through the trusted `World`, never through a view, the terminal's included (F).
- An open door blocks its footprint: only a barrier stands open to walking, so no subject can
  stand in a doorway to keep it from shutting; one the author puts there is moved aside (G).
- The exit door jams a quarter of the time: the terminal's command may be lost to the world's dice,
  and it learns of the jam only through the camera, never why (K).
- A panel is whoever reaches it: the AI and a subject undo each other's commands in turn (L).
- The exit door shuts two ticks after its close: a runner gets through in that window, and an open
  stops the shut. Nothing is simultaneous: a window is only the ticks the door takes
  (G, window test).
