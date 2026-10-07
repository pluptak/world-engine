# Limits: the night shift from inside

What a controller could not decide when `scenarios/watch.json` was played through `actorWorld`
alone: each character chose from its own `observe`, `options` and last verdict, and only the
architect's beats used the `World`. One line per limit, with the step that shows it: `N` is
`tests/scenario-night.test.ts`. Nothing here is a proposal; the gaps are backlog items.

- A character learns of the knock at its next turn, not as it falls: `wait` does not end when the
  actor senses something (only the author's `advance` stops on that), so an idle character waits a
  tick at a time and a turn is a controller's only clock (N step A).
- Turns are ticks: each command takes its own, so with three characters in the order the guard had
  one turn between the knock at tick 5 and the lights due at 8; a turn spent walking would have let
  the gatehouse go dark (N step B).
- A knock heard from `here` names no door: the door stands in the gatehouse, so the guard cannot
  tell a knock on it from a sound in her room, and goes to the door only because it is the one door
  she can name (N step A).
- The view gives positions, not footprints: the guard picks a spot by the door from the door's
  `pos` and finds a free one by trial, her first `move` refused `blocked` by dee (N step C).
- Whether the door is open is not in the view: `open` is a prop the default coverage leaves out, and
  options offer `open` on an open door, which is `ok` and changes nothing; she knows it is open
  only because she opened it (N step C).
- A door with a position belongs to the room it stands in: from the dark yard bob neither sees nor
  gropes for the gatehouse door, and nothing he senses names the room behind it, so he cannot come
  in through the door the guard opened (N step E).
