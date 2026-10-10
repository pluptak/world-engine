# Roles

Who may do what, and when. A plan, not built: `backlog.md` items come from it one at a time, and
[rounds.md](rounds.md) is its companion on time. Today there are two roles, the world author
(`WORLD_AUTHOR`: every `edit` and `advance`, at any time) and the agents (commands, `actorWorld`).

## Words

- **Principal:** whoever is outside the engine: a human, an LLM agent, a test, a middleware.
- **Handle:** what a principal holds to act on a world; one principal may hold several.
- **Role:** a set of permissions a handle carries. A role is not an entity and not a mind.
- **Actor:** the entity a command is made by. **Viewpoint:** the entity perception is computed for.
- The engine checks every operation against its handle's role, and every log line names the handle
  and the role. Access to the files is the host's: a principal given the world's directory has
  every power, so the host hands out handles, never the world.
- The engine answers in codes and data (`reason_code`, `basis_code`, typed events); prose is a
  narrator's, outside the engine, and narration never changes the world.

## Scene and run

A **scene** is the architect's: a setup, a timeline, its levers and limits, made and then marked
ready (an edit after that withdraws it). A **run** is one simulation made from a ready scene: it
starts once and ends once, at tick 0 with its own history. A run is never continued or turned back
into a scene; to play again is to make a new run from the same scene, which replays the same way
given the same inputs.

## The roles

1. **Architect: makes a scene.** Entities and places, state-tier props (`src/engine/fields.ts`),
   the seed; the timeline of beats (everything that happens by intention, a knock included) and a
   pool of beats the director may play; the odds the director may steer, each with its range; the
   tick limit; the player slots (which bodies a player may take). Marks it ready. Never touches a
   run.
2. **Director: runs it, from behind.** Picks a ready scene, makes a run, registers the players
   (binds each player's handle to its slot) and starts it. It reads everything but the moves
   players have submitted and not yet resolved. It acts only through levers the architect tied:
   bringing a queued beat forward, putting it back or cancelling it, playing a beat from the pool,
   steering odds within their ranges, and running the clock. It acts between rounds, before anyone
   submits for the next ([rounds.md](rounds.md)), so it shapes what comes and never answers a move.
   Every lever it pulls becomes ordinary events with a cause in the world, so a character sees the
   knock, never the hand, and the log shows every pull. It never makes a beat, never retimes what
   the engine scheduled (a door's shut, a bleed, a process), never edits the world, never decides
   for a character. It ends the run; the tick limit ends one it does not. A budget of pulls, and any
   further powers, are for later.
3. **Character: plays.** A player bound to a body, which may be any agent the templates allow (a
   dog, a terminal, a sword with a will) and may be several entities in several places (the lab's
   AI is its terminal, its arm and its cameras). Control is not composition: the binding lists the
   entities it drives, and its view has one alias for each thing, read through all their senses.
   Free to do anything the engine allows and nothing else.

`WORLD_AUTHOR` stays, every permission at once, for tests and repair, until the roles replace it.

## Perception is not a turn

What a viewpoint perceives depends on its senses and its state, never on whose turn it is, and
reading never costs time. Conditions act through what they take away: a stun lowers capacities
(built), and bound, asleep, unconscious, blind or deaf would each take its own senses and
capacities, any of them together. Each is its own item, when a scene needs it.

## Open

1. What a saved scene is: today's `scenarios/*.json` grown with beats, the pool, ranges, the tick
   limit and slots, validated as a whole by the engine; the host keeps the list of scenes.
2. How a steered odd is stored: a state prop read in place of the template's value.
3. A character that is a thing: whether an agent can be carried (the sword) and still act.
4. A slot no player takes: the body stands idle, is removed, or the run cannot start.
5. A player whose bodies are all destroyed, and an observer role (a player with no body, read
   only): one view for both, or neither yet. An ended run is readable by whoever holds it.
6. A run with no live player left: ended at once, or left to the tick limit.
