# A door that takes time to shut

A door with a positive `shut_ticks` prop (a definition, on an openable: `templates/shut_door.json`)
does not shut within the command that shuts it. Its close opens a window instead.

**The window.** `close` by hand or by its controller emits `closing`, not `closed`, sets `closing`
on the door and schedules the shut `shut_ticks` ticks on, caused by the `closing`. Until the shut
the door is open, so `move` goes through it. At the shut the scheduled close runs as any close does:
`closed`, the occupants of its footprint moved aside under `moved`, and `closing` cleared.

**Inside the window.** `open` is allowed and stops the shut: it clears `closing` and withdraws the
pending close, under `opened`. A second `close`, or a `lock`, is refused `closing` until the shut
has come; a remote one the same. `closing` is audible, as `closed` is.

**Rules.** `closing` on a door that is not open, or has no pending close, is `closing_without_close`
(`src/engine/validate.ts`), and an `edit` that writes it is refused that code.

Not in it: a `closes_after` swing that takes time (its close stays the end of the swing), opening
that takes time, and a door that crushes or stops on what is in it.
