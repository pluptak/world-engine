# Openable verbs

A target that declares `openable` (a door, a gate, a chest) is opened, shut, locked and unlocked.

- `open`: sets `open` on an `openable` target under an `opened` event, and with `closes_after` a
  close is scheduled ([schedule.md](schedule.md)); an open target is refused `already_open` (after reach,
  before `locked`), since it would change nothing, and `locked` is refused. A door joins two rooms
  through its `from` and `to` props. Without a position it is in reach from anywhere in either room; with
  one it keeps that position in the room it stands in, and from the room it leads to it is reached as an
  unpositioned door is, so from the dark yard one names, opens and shuts the gatehouse door.
- `close`: a target that is shut (or never opened) is refused `already_closed`; a target with `shut_ticks`
  opens its window instead, `closing` ([door-window.md](door-window.md)); otherwise sets that prop false
  under `closed`, first moving what stands on the target's footprint
  aside, each under a `moved` caused by the `closed` ([schedule.md](schedule.md)); a shut container
  hides its chain, so `take` and `put` refuse `container_closed` and sight inside is `false`.
- `lock`: sets `locked` under a `locked` event; needs `manipulation` and a carried entity whose
  `opens` is the target's id, else `no_key`. A target already locked is refused `already_locked`, after
  reach and before the key.
- `unlock`: the same requirement, clearing `locked` under `unlocked`; a target that is not locked (or
  never was) is refused `already_unlocked`, in the same place.
- From the target's controller, all four skip reach, the key and hands, and refuse `disconnected`
  or `unpowered` where a link fails ([power.md](power.md)). A device with a `jam_pct` may jam that
  command instead, [jam.md](jam.md).
