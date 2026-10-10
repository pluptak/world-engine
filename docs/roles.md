# Roles

A role is a set of permissions a handle carries. Two roles exist: the author (the bare `World`,
which may send every edit and round) and the director (`directorWorld(world)`,
`src/director-world.ts`). Access to the world's files is the host's: a handle is what the host
hands out, never the `World`.

**Registering.** On a registering run a director registers each player with
`register_player { handle, slot }`, which binds the handle, a token, to one of the run's slots.
One slot per handle and one handle per slot; a slot nobody registers stays idle. The run keeps the
players in the order they registered (`run.players`). Refused `no_run`, `run_not_registering`,
`no_such_slot`, `slot_taken` and `handle_taken`.

**Who may send what.** Each edit kind names the roles that may send it. The director may send
`register_player`, `start_run`, `end_run`, `retime_beat` and `cancel_beat`, and nothing else: a
`spawn` or `set_props` it sends is refused `role_forbidden`. The author keeps every kind.

**The record.** A logged command carries the role it was sent under as `by` (`{ role, handle? }`),
set by the handle. A command the bare World sends has no `by`, which is the author. `attempts`, the
store's log and `verify` carry it.

**The director's handle.** It reads everything a `World` reads (`snapshot`, `schedule`, `query`,
`observe`, `inspect`, `since`, `attempts`) and writes only through `edit`, under the director
role. It has no `command`: a director never acts as a character. `round` is still the
author's. The CLI's `director_edit` op is the same `edit` under that role.

**Not in it.** A player's handle, several slots per handle, and the architect as a role (a scene
is a file, made outside any world).
