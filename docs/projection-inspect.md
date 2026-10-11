# Inspecting one entity

`world.inspect(observer, entity)` is one entity of the observer's projection
([projection.md](projection.md)) in more detail, or `null` when the observer senses nothing of it:

- the same senses and facts, and `reachable` where coverage declares it;
- with sight or touch, the covered props (`open` by default; an amount as `levels`);
- `size_cm`, the template's width, depth and height that a position is a centre of, so a caller
  can tell whether two things overlap, or a spot is free;
- `parts`, a body's parts in the template's order as `{ name, status }` (`intact`, `damaged`,
  `destroyed` or `detached`, a part under a severed one reading as it does), with `integrity`
  where coverage declares that property; a world that does not cover the `status` relation
  shows none;
- `holds`, the listed entities on it or in it;
- its `traits` when it has any (`observe` lists none, and coverage does not gate them).

The CLI's `inspect` op takes `observer` and `entity`.

`command(c, { observe: true })` attaches `observation`, the actor's projection after the command
with `since` the version it was applied to: its own events as the actor sensed them, none if it
was refused. The CLI's `command` op takes `observe` alike.
