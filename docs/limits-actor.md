# Limits: the scenarios from inside

What a controller could not decide when `scenarios/watch.json` and `scenarios/cell.json` were played
through `actorWorld` alone: each character chose from its own `observe`, `options`, `inspect` and last
verdict (`tests/actor-harness.ts` drives them), and only the architect's beats used the `World`. One line
per limit, with the step that shows it: `N` is `tests/scenario-night.test.ts`, `C` is
`tests/scenario-cell-actor.test.ts`. Nothing here is a proposal; each is a fact of how the engine works,
kept so a controller's author knows it.

- Turns are ticks: each command takes its own, so with three characters in the order the guard had
  one turn between the knock at tick 5 and the lights due at 8; a turn spent walking would have let
  the gatehouse go dark (N step B).
- A knock heard from `here` names no door: the door stands in the gatehouse, so the guard cannot
  tell a knock on it from a sound in her room, and goes to the door only because it is the one door
  she can name (N step A).

## The cell

- Whether a gate is locked, and what a key opens, is in no view or inspection (`locked` and `opens` are
  not in the default coverage): only the options say, by what is ready and what is blocked (C steps B, D).
  Whether it stands open an inspection shows, as the default covers `open`; when these runs were played
  it did not, and she read that off her options too (C step E).
- `unlock` and `open` are refused `out_of_reach` before anything else is checked, so a controller learns it
  has no key, or that the gate is locked, only once it stands in reach of the gate; from where she starts
  every one of them reads `out_of_reach` (C steps A, B).
- `reach_cm` is in no view either: how close is close enough is read from `reachable` in an inspection or from
  an `out_of_reach` in the options, after walking there. Against the bars from where she starts (100 cm
  from them) the nearest he can stand is 118 cm from her and a human reaches 100, so they can meet only by
  both walking to the gate (C step A).
- `move` is never ready or blocked in the options (its destination is free), so where to stand is the controller's
  own arithmetic on inspected footprints (a gate 5 deep and a human 30 leave 18 cm from its centre line), and
  whether the shut gate stops her walk is learned by issuing it: refused `blocked`, naming the gate, in no time
  (C steps A, B).
