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
role. It has no `command` and no `round`: a director never acts as a character. It closes a
round with the players' moves (`closeRound`, [rounds.md](rounds.md)). The CLI's
`director_edit` op is the same `edit` under that role.

**The player's handle.** `playerWorld(world, handle)` (`src/player-world.ts`) is the actor view of
the body the handle's slot is bound to, under the player role: `observe`, `inspect`, `options` and
`check`, and no `command`. It also `submit`s one move for the next round, `withdraw`s it and reads
its `pending()` move. A new submit replaces the old. Refused `not_registered` for an unregistered
handle and `run_not_running` before the run starts. Nothing it reads names another player's move,
and its pending move is held in the world, not in its state ([rounds.md](rounds.md)).

**Not in it.** Several slots per handle, timeouts (the host's), and the architect as a role (a
scene is a file, made outside any world).