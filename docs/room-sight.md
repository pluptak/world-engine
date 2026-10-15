# Sensing a room

A room (`templates/room.json`) is sensed as the things in it are, so an observation names the rooms
its references point to.

- **Sight.** A room is its own location. It is seen from inside it when it is lit
  (`same_location_lit`), and through an open door when both rooms are lit
  (`adjacent_open_door_lit`). A camera sees the lit room it stands in (`camera`). A dark room is
  `location_unlit`, and a room behind a shut door is `not_perceptible`.
- **Touch.** A body feels the room it stands in, dark or not (`same_location`). A body inside
  something (`contained_in`) feels that instead.
- **Hearing and smell.** These are read as for anything in the room: a room is always heard from
  inside it, and smelt from inside it only when residue lies on it.

```
  hall (lit) --open door-- corridor (lit)   ann in hall: sees and feels hall, sees corridor
      |
  open door
      |
  cellar (dark)                             ann does not see it; bea in it only feels it
```

What follows:

- `observe` lists every room sensed by sight or touch, with its `name`, `template` and facts. So
  a `location` that names a seen room is shown, not `hidden`. `inspect` on a room lists what
  stands on it.
- A seen room is addressable (`Perception.Addressable`), so naming it in a command resolves it.
  A verb that cannot take a room refuses it with its own code instead of `unresolved`.
- Event perception is unchanged: an event's subject is read as before ([senses.md](senses.md)).

Tests: `RoomSightTests`.
