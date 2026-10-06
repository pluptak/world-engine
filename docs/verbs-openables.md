# Openable verbs

A target that declares `openable` (a door, a gate, a chest) is opened, shut, locked and unlocked.

- `open`: sets `open` on an `openable` target under an `opened` event, and with `closes_after` a
  close is scheduled ([schedule.md](schedule.md)); `locked` is refused. A door joins two rooms
  through its `from` and `to` props and is in reach and in view from either.
- `close`: sets that prop false under `closed`; a shut container hides its chain, so `take` and
  `put` refuse `container_closed` and sight inside is `false`.
- `lock`: sets `locked` under a `locked` event; needs `manipulation` and a carried entity whose
  `opens` is the target's id, else `no_key`.
- `unlock`: the same requirement, clearing `locked` under `unlocked`.
