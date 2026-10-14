# Roles

A role is a set of permissions a handle carries: the author (the bare world, `IWorld`, which may
send every edit and round), the director (`new DirectorWorld(world)`,
`Core/Engine/Worlds/DirectorWorld.cs`), and the player (`new PlayerWorld(world, handle)`,
`PlayerWorld.cs`). Access to the world's files is the host's: a handle is what the host hands out,
never the world.

**Registering.** On a registering run a director registers each player with
`register_player { handle, slot }`, which binds the handle, a token, to one of the run's slots.
One slot per handle and one handle per slot; a slot nobody registers stays idle. The run keeps the
players in the order they registered (`run.players`). Refused `no_run`, `run_not_registering`,
`no_such_slot`, `slot_taken` and `handle_taken`.

**Who may send what.** Each edit kind names the roles that may send it. The director may send
`register_player`, `start_run`, `end_run`, `retime_beat` and `cancel_beat`, and nothing else: a
`spawn` or `set_props` it sends is refused `role_forbidden`. The author keeps every kind.

**The record.** A logged command carries the role it was sent under as `by` (`{ role, handle? }`),
set by the handle. A command the bare world sends has no `by`, which is the author. `attempts`, the
store's log and `verify` carry it.

**The director's handle.** It reads the snapshot (`Current`) and writes only through `Edit`, under
the director role; the host gives it any other read of the world. It has no command and no round
of its own: a director never acts as a character. It closes a round with the players' moves
(`CloseRound`, [rounds.md](rounds.md)); it learns which handles have submitted (`Submitted`),
never their moves. The CLI's `director_edit` op is the same `edit` under that role.

**The player's handle.** `PlayerWorld` is the actor view of the bodies the handle's slot drives,
under the player role, with no command of its own. `Observe` and `Inspect` read through every body
of the slot: each thing and event is listed once, from the first body in slot order that senses
it. `Options`, `Check` and `Submit` are per body. It `Submit`s one move for the next round,
`Withdraw`s them, reads its `Pending()` (a list, one move per body), all written as the view
writes. A new submit for a body replaces that body's move. Refused
`not_registered` and, before the run starts, `run_not_running`. Nothing it reads names another
player's move. A player drives the successor that took its body over ([templates.md](templates.md)).

**Several bodies.** A slot may hold several bodies ([scenario.md](scenario.md)), named by its first
one, which `register_player` takes. One handle drives them all, and the view names a thing alike
from every body of the slot: its aliases are keyed by the slot's first body. A move names its body
by `body`, the view's alias for it, which is omitted when the slot holds one body. A move for each
body is one move of the round, each logged under the handle. `Options`, `Check` and `Withdraw` take
the same `body`; `Options` and `Check` without one are `body_required` for a slot of several. A body
the handle does not drive is refused `not_a_body`, and a submit without one `body_required`. A
body's move that its successor takes over is that successor's (`Runs.LiveBodyOf`). A body removed
from the world senses nothing, and the view reads through the slot's other bodies.

A body that is out (destroyed, or gone from the world, with no successor) is refused `body_out`
by `Submit` and `Check`; its `Options` are empty with that `reason_code`. A move submitted while the
body lived is the round's to decide, as it is now.

**Not in it.** Several slots per handle, a body joining or leaving a slot during a run, timeouts
(the host's), the architect as a role (a scene is a file, made outside any world), a budget of
pulls, odds other than a door's `jam_pct`, and a director that picks outcomes.
