# Limits: the werewolf

What `scenarios/werewolf.json` (wil, cursed to turn at moonrise, ada and a cart, in a lit village)
could not say, and what the engine does instead. The shipped set has no werewolf; the tests add one
extending `human` with larger amounts, as a story's library would. One line per limit, each shown by
the test of `LimitsWerewolfTests` named after it. Nothing here is a proposal.

- Moonrise cannot turn wil: a beat carries no `refine`, so the scene's beat is only a loud sound on
  him (`A_beat_cannot_turn_a_body_into_another_class`).
- Only the author turns a body, and only down its lineage: `refine` to `werewolf` gives wil its
  amounts, and turning back to `human` is `not_a_refinement`
  (`The_author_turns_a_body_down_its_lineage_and_never_back`).
- Strength is the class, not the body: `attack_damage` is a definition, refused `field_not_editable`,
  and an affliction of +50 leaves a capacity at its ceiling of 100 (`Strength_is_the_class_not_the_body`).
