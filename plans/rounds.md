# Rounds

How time passes when several players act. A plan, not built; the roles are in
[roles.md](roles.md). Today every command moves the clock by its own duration, so one player's
`wait` moves the world for everyone, and a fast player outpaces a slow one.

## The idea

Every player decides against the same world, without seeing what the others chose; the engine
then resolves the moves one after another in an order no one picks, and the clock moves once.
Nothing is simultaneous: moves in one round share a tick but resolve in sequence. Reading the
world never moves the clock, and neither does submitting a move.

## One round

1. The round starts from the world as the last round left it.
2. The director's levers are applied ([roles.md](roles.md)), before anyone submits.
3. Players submit at most one move each. A handle sees only its own pending move; the director
   sees none, and nothing a player can read shows another's.
4. **Check:** each move is checked against the round's starting world (the handle may drive the
   actor, the actor can act, the target resolves); one that fails is refused with its own code.
5. **Resolve:** the rest are applied one by one, in an order drawn from a stream of the world's own,
   apart from the dice (from the seed and the tick, say), so adding a player never changes whether
   a door jams. Each is checked again against the world the earlier ones left, and one that no
   longer holds is refused with its own code (two reach for one key: the first takes it, the
   second is `already_held`). A refused move is not retried.
6. Then what falls due at the tick runs, in today's order: modifiers expire, then the schedule.
7. The clock moves one tick, and the round's events are there to be read.

The round is recorded whole (moves, order, outcomes), so a run replays exactly.

## Not sorted into independent and conflicting

Proving two moves independent means knowing everything each reads and writes: falls, pushes, a
shutting door moving people, light that decides what can be named, dice. Moves that are independent
give the same result in any order anyway, so the drawn order is enough. Where a scene wants a
conflict settled by a rule rather than by the order (two hands on one key, the stronger wins), that
pair gets its own contest rule, one at a time.

## Changes this asks of the engine

- Commands in a round share a tick, which `backlog.md`'s out-of-scope line ("two commands never
  share a tick") rules out today; that line goes when the first round item is written.
- A command applied in a round does not move the clock; the round does, once.

## Open

1. A move that takes longer than a tick (`wait 5`, an `advance`): it occupies the player for that
   many rounds, or it is not a round move at all.
2. A player who submits nothing: a pass. How long a round waits is the host's.
3. A player who cannot act (destroyed, stunned past moving): a pass the engine makes for it, or a
   refusal it learns from.
4. The director running the clock: rounds with no moves, or `advance` kept beside them.
5. What reads "before or after the command" (event-form perception, `perceivers`) means for moves
   that share a tick: before or after each move, as now.
