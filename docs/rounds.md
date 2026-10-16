# Rounds

`TakeRound(moves)` takes one round: every move is decided against the same world, the moves are
taken in an order no caller picks, and the clock moves once. Each move is a command of a verb that
lasts one tick (`take`, `move`, `open`, ...); `wait`, `advance` and `edit` are not moves
(`not_a_round_move`). An actor with no move passes. The CLI's `round` op takes `moves` the same way.

**Checks.** Two moves from one actor refuse the whole round `duplicate_actor`, applying nothing. Two
or more moves in a world with no dice refuse the round `no_seed`. Each move is checked against the
round's starting world, and one that fails there is refused with its own code and takes no part.

**Order.** The rest are taken in an order from a stream of their own, seeded by the dice's state
at the round's start and the tick, with the moves sorted by actor first; it never advances the dice
(`Rng.RoundOrder`). So the order depends neither on the order moves were sent in
nor on any move's roll. Each move is based on the round's starting version, so one that would have
succeeded there but fails after an earlier move is `preempted`; nothing is retried.

**Time.** A move takes no time of its own. The clock moves one tick when the round closes, and what
falls due in it runs as now; an empty round is that tick alone. A move's command carries the round
flag through the log, as `perceivers` does, so replay applies it the same way.

**The record.** Each move is one log line with its status, the round's number and its place in
the order (absent for a move refused where the round started). The close is a line of its own,
marked `close`. `attempts` and `since` read them as they read any command. A `command` or `beat`
that carries the round flag is refused `invalid_args`: only a round makes a move take no time.

**In a run.** While a run is running, an agent acts only in a round: a lone command, and the
author's `advance`, are refused `round_only` ([run.md](run.md)); `check` and `options` judge an
agent's command as a move, so they list what a round would take. A run that is ended refuses a
round as it refuses anything; a round outside a run works on any world.

**Submitting and closing.** A player's handle submits one move for the next round, held in the world
as pending, one move per body it drives, not as state: no version and no log line until the round
closes ([roles.md](roles.md)). The director's `CloseRound()` takes every pending move as one round,
each under its player's role and the close under the director's; it clears them only when the round
is taken. A round the world refuses keeps them for the next close. A store world keeps pending moves
in `pending.json` beside its log, under its turn; a replay never reads it.

**Not in it.** Contest rules for a conflict and a carried agent's move. Levers and quiet rounds are
in [roles-levers.md](roles-levers.md). Tests: `RoundGoldenTests`, `CliRoundTests`.
