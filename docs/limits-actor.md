# Limits: the night shift from inside

What a controller could not decide when `scenarios/watch.json` was played through `actorWorld`
alone: each character chose from its own `observe`, `options` and last verdict, and only the
architect's beats used the `World`. One line per limit, with the step that shows it: `N` is
`tests/scenario-night.test.ts`. Nothing here is a proposal; each is a fact of how the engine works, kept so a controller's author
knows it.

- Turns are ticks: each command takes its own, so with three characters in the order the guard had
  one turn between the knock at tick 5 and the lights due at 8; a turn spent walking would have let
  the gatehouse go dark (N step B).
- A knock heard from `here` names no door: the door stands in the gatehouse, so the guard cannot
  tell a knock on it from a sound in her room, and goes to the door only because it is the one door
  she can name (N step A).
