# Power switch verbs

A link of a power walk is switched off and on again by hand or by its controller.

- `switch_off`: sets `on: false` on a target that is a `power_source` or has a `powered_by`,
  else refused `not_switchable`; a target already off is refused `already_off`. Needs reach and
  `manipulation`, takes one tick, and emits `switched { on: false }` on the target, sensed as
  `opened` is. Power past the link fails with it, as with a cut cable ([power.md](power.md)).
- `switch_on`: sets `on: true` the same way; a target already on (absent included) is refused
  `already_on`. An agent that switched off the walk that powers itself cannot switch it back:
  every command is refused `unpowered` until power returns.
- From the target's controller, or from a subject at a panel on its walk ([panel.md](panel.md)),
  both skip reach and hands, and refuse `disconnected` or `unpowered` where a link fails, exactly
  as `open` does ([verbs-openables.md](verbs-openables.md), [power.md](power.md)). Tests:
  `tests/switch.test.ts`.
