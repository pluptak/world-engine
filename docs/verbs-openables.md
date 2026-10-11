# Openable verbs

A target that declares `openable` (a door, a gate, a chest) is opened, shut, locked and unlocked.

- `open`: sets `open` on an `openable` target under an `opened` event; an open target is refused
  `already_open` (after reach, before `locked`), since it would change nothing, and `locked` is
  refused. A door joins two rooms through its `from` and `to` props. Without a position it is in
  reach from anywhere in either room; with one it keeps that position in the room it stands in, and
  from the room it leads to it is reached as an unpositioned door is, so from the dark yard one
  names, opens and shuts the gatehouse door.
  - With a positive `closes_after`, a close is scheduled that many ticks on, caused by the `opened`
    ([schedule.md](schedule.md)): opened at tick 4 with `closes_after: 2`, it emits `closed` at 6,
    during whichever command spans 6. The count stands until it runs out.
  - A close by hand withdraws the pending close; opening again, or after the author shut it,
    starts a fresh count. Neither records anything about the withdrawal.
  - An openable that comes to be open any other way (placed open by a scenario, spawned,
    edited open, refined into one) is scheduled the same way, caused by the `spawned` or
    `edited`, or by nothing for one a scenario placed: that `closed` is a root. The verb's own
    close is never doubled.
- `close`: a target that is shut (or never opened) is refused `already_closed`; a target with
  `shut_ticks` opens its window instead, `closing` ([door-window.md](door-window.md)); otherwise
  sets that prop false under `closed`. A shut container hides its chain, so `take` and `put` refuse
  `container_closed` and sight inside is `false`.
  - First, everything standing on the target's footprint, agents and items alike, is moved just
    clear along its thin axis (a tie goes positive), each under a `moved` caused by the `closed`,
    uncovering what it hid. A scheduled close does the same.
  - What a walk would not meet stays: anything lower than `STEP_OVER_CM`, broken, or rubble
    ([occupancy.md](occupancy.md)). A door between rooms has no footprint, so it moves
    nothing. Tests: `tests/scenario-cell.test.ts`.
- `lock`: sets `locked` under a `locked` event; needs `manipulation` and a carried entity whose
  `opens` is the target's id, else `no_key`. A target already locked is refused `already_locked`,
  after reach and before the key.
- `unlock`: the same requirement, clearing `locked` under `unlocked`; a target that is not locked
  (or never was) is refused `already_unlocked`, in the same place.
- From the target's controller, or from a subject at a panel on its walk ([panel.md](panel.md)), all
  four skip reach, the key and hands, and refuse `disconnected` or `unpowered` where a link fails
  ([power.md](power.md)). A device with a `jam_pct` may jam that
  command instead, [jam.md](jam.md).
