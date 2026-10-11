# Roles

A role is a set of permissions a handle carries: the author (the bare `World`, which
may send every edit and round), the director (`directorWorld(world)`, `src/director-world.ts`),
and the player (`playerWorld(world, handle)`, `src/player-world.ts`). Access to the world's
files is the host's: a handle is what the host hands out, never the `World`.

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
round with the players' moves (`closeRound`, [rounds.md](rounds.md)); it learns which handles
have submitted, never their moves. The CLI's `director_edit` op is the same `edit` under that role.

**The player's handle.** `playerWorld(world, handle)` (`src/player-world.ts`) is the actor view
of the bodies the handle's slot drives, under the player role, and no `command`. `observe` and
`inspect` read through every body of the slot: each thing and event is listed once, from the first
body in slot order that senses it. `options`, `check` and `submit` are per body. It `submit`s one
move for the next round, `withdraw`s them, reads its `pending()` (a list, one move per body), all
written as the view writes. A new submit for a body replaces that body's move. Refused
`not_registered` and, before the run starts, `run_not_running`. Nothing it reads names another
player's move. A player drives the successor that took its body over (`docs/templates.md`).

**Several bodies.** A slot may hold several bodies (`docs/scenario.md`), named by its first one,
which `register_player` takes. One handle drives them all, and the view names a thing alike from
every body of the slot: its aliases are keyed by the slot's first body. A move names its body by
`body`, the view's alias for it, which is omitted when the slot holds one body. A move for each
body is one move of the round, each logged under the handle. `options`, `check` and `withdraw` take
the same `body`; `options` and `check` without one are `body_required` for a slot of several. A body
the handle does not drive is refused `not_a_body`, and a submit without one `body_required`. A
body's move that its successor takes over is that successor's (`liveBodyOf`).

**Not in it.** Several slots per handle, a body joining or leaving a slot during a run, timeouts (the
host's), the architect as a role (a scene is a file, made outside any world), a budget of pulls, odds
other than a door's `jam_pct`, and a director that picks outcomes.
