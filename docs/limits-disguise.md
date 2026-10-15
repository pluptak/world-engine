# Limits: the disguise

What `scenarios/disguise.json` (sean, castor who would wear sean's face, and a guard, in a lit hall)
could not say, and what the engine does instead. One line per limit, each shown by the test of
`LimitsDisguiseTests` named after it. Nothing here is a proposal.

- A name is given at spawn and never after: an edit naming `name` is refused `undeclared_prop`, so
  castor cannot answer to sean's (`A_name_cannot_be_changed_after_spawn`).
- A face is no part that moves: a human's `head` is not detachable, so Sockets cannot carry one face
  from body to body (`A_face_is_no_part_that_moves`).
